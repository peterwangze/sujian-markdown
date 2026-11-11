const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createHash, randomUUID } = require('node:crypto');

const documentExtension = /\.(?:md|markdown|mdown|mkd|mkdn|mdwn|mdtxt|mdtext|rmd|qmd|txt|text)$/i;
const queues = new Map();

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function decode(bytes) {
  let encoding = 'utf-8';
  let markerLength = 0;
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    markerLength = 3;
  } else if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) {
    encoding = 'utf-16le';
    markerLength = 2;
  } else if (bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) {
    encoding = 'utf-16be';
    markerLength = 2;
  }

  const source = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes.subarray(markerLength));
  const eols = source.match(/\r\n|\n|\r/g) ?? [];
  const text = source.replace(/\r\n|\r/g, '\n');
  const counts = new Map();
  for (const ending of eols) counts.set(ending, (counts.get(ending) ?? 0) + 1);
  const preferred = [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? '\n';
  return { text, source, encoding, marker: bytes.subarray(0, markerLength), eols, preferred };
}

function preserveLineEndings(text, previous) {
  const before = previous.text.split('\n');
  const after = text.split('\n');
  const endings = new Array(after.length - 1);
  let oldIndex = 0;
  let newIndex = 0;
  let oldEnd = before.length - 1;
  let newEnd = after.length - 1;
  while (oldIndex <= oldEnd && newIndex <= newEnd && before[oldIndex] === after[newIndex]) {
    endings[newIndex++] = previous.eols[oldIndex++];
  }
  while (oldEnd >= oldIndex && newEnd >= newIndex && before[oldEnd] === after[newEnd]) {
    endings[newEnd--] = previous.eols[oldEnd--];
  }
  while (oldIndex <= oldEnd && newIndex <= newEnd) {
    if (before[oldIndex] !== after[newIndex]) {
      const oldMatch = before.slice(oldIndex + 1, Math.min(oldEnd + 1, oldIndex + 25)).indexOf(after[newIndex]);
      const newMatch = after.slice(newIndex + 1, Math.min(newEnd + 1, newIndex + 25)).indexOf(before[oldIndex]);
      if (oldMatch >= 0 && (newMatch < 0 || oldMatch < newMatch)) {
        oldIndex += oldMatch + 1;
        continue;
      }
      if (newMatch >= 0 && (oldMatch < 0 || newMatch < oldMatch)) {
        newIndex += newMatch + 1;
        continue;
      }
    }
    endings[newIndex++] = previous.eols[oldIndex++];
  }
  return after.map((line, index) => index === after.length - 1 ? line : line + (endings[index] ?? previous.preferred)).join('');
}

function encode(text, previous) {
  const normalized = text.replace(/\r\n|\r/g, '\n');
  if (!previous) return Buffer.from(normalized, 'utf8');
  let source = normalized;
  if (previous.text === normalized) source = previous.source;
  else if (previous.eols.length) {
    source = previous.eols.every((ending) => ending === previous.preferred)
      ? normalized.replaceAll('\n', previous.preferred)
      : preserveLineEndings(normalized, previous);
  }
  const bytes = Buffer.from(source, previous.encoding === 'utf-8' ? 'utf8' : 'utf16le');
  if (previous.encoding === 'utf-16be') bytes.swap16();
  return Buffer.concat([previous.marker, bytes]);
}

function pathKey(filePath) {
  const absolute = path.resolve(filePath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

async function readBounded(handle, size, maxBytes) {
  const tooLarge = () => Object.assign(new Error('The document exceeds the read limit.'), { code: 'ERR_DOCUMENT_TOO_LARGE' });
  if (size > maxBytes) throw tooLarge();
  const buffer = Buffer.allocUnsafe(maxBytes + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (!bytesRead) return buffer.subarray(0, offset);
    offset += bytesRead;
  }
  throw tooLarge();
}

async function readFile(filePath, { maxBytes, requireCanonical = false } = {}) {
  const absolute = path.resolve(filePath);
  const resolved = await fs.realpath(absolute);
  if (requireCanonical && pathKey(resolved) !== pathKey(absolute)) {
    throw Object.assign(new Error('The document path changed.'), { code: 'ERR_DOCUMENT_PATH_CHANGED' });
  }
  if (!(await fs.stat(resolved)).isFile()) throw new Error('The selected path is not a file.');
  const handle = await fs.open(resolved, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('The selected path is not a file.');
    const bytes = maxBytes === undefined ? await handle.readFile() : await readBounded(handle, stat.size, maxBytes);
    return { path: resolved, bytes, hash: digest(bytes), stat };
  } finally {
    await handle.close();
  }
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

function snapshot(file) {
  if (!file) return null;
  const { text, preferred, encoding, marker } = decode(file.bytes);
  return {
    path: file.path, name: path.basename(file.path), text, hash: file.hash,
    mtimeMs: file.stat.mtimeMs, encoding, eol: preferred, bom: marker.length > 0,
  };
}

async function renameWithRetry(temporary, filePath, beforeReplace) {
  const retryDelays = [15, 30, 60, 120, 240, 480];
  for (let attempt = 0; ; attempt += 1) {
    await beforeReplace?.();
    try {
      await fs.rename(temporary, filePath);
      return;
    } catch (error) {
      const retryDelay = retryDelays[attempt];
      if (process.platform !== 'win32' || !retryDelay || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      await delay(retryDelay);
    }
  }
}

async function atomicWrite(filePath, bytes, { mode = 0o600, preserveMode = false, noReplace = false, beforeReplace } = {}) {
  const parent = path.dirname(filePath);
  const temporary = path.join(parent, `.sujian-${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, 'wx', mode);
    try {
      await handle.writeFile(bytes);
      if (preserveMode && process.platform !== 'win32') await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (noReplace) {
      await beforeReplace?.();
      try {
        await fs.link(temporary, filePath);
      } catch (error) {
        if (!['ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM'].includes(error.code)) throw error;
        await renameWithRetry(temporary, filePath, beforeReplace);
      }
    } else {
      await renameWithRetry(temporary, filePath, beforeReplace);
    }
    if (process.platform !== 'win32') {
      const directory = await fs.open(parent, 'r').catch(() => null);
      if (directory) {
        await directory.sync().catch(() => {});
        await directory.close();
      }
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function serialized(filePath, task) {
  const key = pathKey(filePath);
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  queues.set(key, current);
  return current.finally(() => {
    if (queues.get(key) === current) queues.delete(key);
  });
}

async function getDocument(filePath, options) {
  return snapshot(await readFile(filePath, options));
}

async function saveDocument({ path: filePath, text, expectedHash, force = false }) {
  if (typeof text !== 'string') throw new TypeError('Document text is required.');
  const absolute = path.resolve(filePath);
  const resolved = await fs.realpath(absolute).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return absolute;
  });
  return serialized(resolved, async () => {
    const current = await readOptional(resolved);
    const conflict = (file) => ({ status: 'conflict', document: snapshot(file) });
    const forceWithoutVersion = force && expectedHash === undefined;
    if (!forceWithoutVersion && (current?.hash ?? null) !== (expectedHash ?? null)) return conflict(current);
    let previous;
    if (current) {
      try {
        previous = decode(current.bytes);
      } catch (error) {
        if (!force) throw error;
      }
    }
    const bytes = encode(text, previous);
    if (current?.bytes.equals(bytes)) return { status: 'ok', document: snapshot(current) };
    const changed = new Error('The file changed before it could be saved.');
    let latest;
    try {
      await atomicWrite(resolved, bytes, {
        mode: current ? current.stat.mode & 0o777 : 0o666,
        preserveMode: Boolean(current),
        noReplace: !current,
        async beforeReplace() {
          latest = await readOptional(resolved);
          if ((latest?.hash ?? null) !== (current?.hash ?? null)) throw changed;
        },
      });
    } catch (error) {
      if (error === changed) return conflict(latest);
      if (!current && error.code === 'EEXIST') return conflict(await readOptional(resolved));
      throw error;
    }
    const written = await readFile(resolved);
    if (written.hash !== digest(bytes)) return conflict(written);
    return { status: 'ok', document: snapshot(written) };
  });
}

module.exports = { atomicWrite, decode, documentExtension, getDocument, pathKey, saveDocument, serialized };

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { atomicWrite, pathKey, serialized } = require('./documents.cjs');

const fontRoute = '/user-fonts/';
const fontId = /^[a-f0-9]{64}$/;
const fontPath = /^\/user-fonts\/([a-f0-9]{64})\.(ttf|otf|woff|woff2)$/;
const maxFontBytes = 64 * 1024 * 1024;
const maxManifestBytes = 512 * 1024;
const fontTypes = {
  ttf: { format: 'truetype', mime: 'font/ttf', signatures: [0x00010000, 0x74727565] },
  otf: { format: 'opentype', mime: 'font/otf', signatures: [0x4f54544f, 0x00010000] },
  woff: { format: 'woff', mime: 'font/woff', signatures: [0x774f4646] },
  woff2: { format: 'woff2', mime: 'font/woff2', signatures: [0x774f4632] },
};
const acceptedExtensions = Object.keys(fontTypes);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const filename = entry => `${entry.id}.${entry.extension}`;
const ignoreMissing = error => { if (error.code !== 'ENOENT') throw error; };

function invalidFont() {
  return new Error('字体内容无效，或与文件格式不符。');
}

function verifyDirectory(bytes, count, start, step, compressed) {
  const end = start + count * step;
  if (end > bytes.length) throw invalidFont();
  const tables = new Set();
  for (let index = start; index < end; index += step) {
    const tag = bytes.toString('ascii', index, index + 4);
    const offset = bytes.readUInt32BE(index + (compressed ? 4 : 8));
    const length = bytes.readUInt32BE(index + (compressed ? 8 : 12));
    if (tables.has(tag) || offset < end || offset + length > bytes.length) throw invalidFont();
    if (compressed && length > bytes.readUInt32BE(index + 12)) throw invalidFont();
    tables.add(tag);
  }
  if (!['cmap', 'head', 'maxp'].every(tag => tables.has(tag)) ||
      !['glyf', 'CFF ', 'CFF2'].some(tag => tables.has(tag))) throw invalidFont();
}

function verifyFont(bytes, extension) {
  if (bytes.length < 12 || !fontTypes[extension].signatures.includes(bytes.readUInt32BE(0))) throw invalidFont();
  if (extension === 'ttf' || extension === 'otf') {
    verifyDirectory(bytes, bytes.readUInt16BE(4), 12, 16, false);
    return;
  }

  const minimum = extension === 'woff2' ? 48 : 44;
  if (bytes.length <= minimum || bytes.readUInt32BE(8) !== bytes.length ||
      bytes.readUInt16BE(12) < 4 || bytes.readUInt16BE(14) !== 0) throw invalidFont();
  const decodedLength = bytes.readUInt32BE(16);
  if (decodedLength < 12 || decodedLength > maxFontBytes * 2) throw invalidFont();
  if (extension === 'woff') {
    verifyDirectory(bytes, bytes.readUInt16BE(12), 44, 20, true);
  } else {
    const compressedLength = bytes.readUInt32BE(20);
    if (!compressedLength || compressedLength > bytes.length - minimum) throw invalidFont();
  }
}

async function readRegularFile(filePath, limit) {
  const initial = await fs.lstat(filePath);
  if (!initial.isFile() || initial.size > limit) throw new Error('文件格式不受支持，或文件超过大小限制。');
  const handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || initial.dev !== stat.dev || initial.ino !== stat.ino || stat.size > limit) {
      throw new Error('无法读取已经更改的文件。');
    }
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) throw new Error('无法读取已经更改的文件。');
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

function fontName(source) {
  const name = path.basename(source, path.extname(source)).normalize('NFC')
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  return Array.from(name).slice(0, 120).join('') || '导入字体';
}

function createFontStore(userData, { origin, devOrigin } = {}) {
  async function directory(create) {
    if (create) await fs.mkdir(userData, { recursive: true, mode: 0o700 });
    try {
      const root = path.join(await fs.realpath(userData), 'fonts');
      if (create) await fs.mkdir(root, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      if (!(await fs.lstat(root)).isDirectory() || pathKey(await fs.realpath(root)) !== pathKey(root)) {
        throw new Error('字体库路径无效。');
      }
      return root;
    } catch (error) {
      ignoreMissing(error);
      return null;
    }
  }

  async function manifest(root) {
    let contents;
    try {
      contents = await readRegularFile(path.join(root, 'manifest.json'), maxManifestBytes);
    } catch (error) {
      ignoreMissing(error);
      return [];
    }
    const entries = JSON.parse(contents.toString('utf8'));
    if (!Array.isArray(entries) || entries.some(entry =>
      !entry || typeof entry.id !== 'string' || !fontId.test(entry.id) ||
      !acceptedExtensions.includes(entry.extension) || typeof entry.name !== 'string' ||
      !Number.isInteger(entry.size) || entry.size < 12 || entry.size > maxFontBytes
    )) throw new Error('无法读取字体库。');
    return entries;
  }

  function publicFont(entry) {
    return {
      id: entry.id,
      name: entry.name,
      format: fontTypes[entry.extension].format,
      url: `${origin}${fontRoute}${filename(entry)}`,
    };
  }

  async function available(root, entries) {
    const fonts = await Promise.all(entries.map(async entry => {
      const stat = await fs.lstat(path.join(root, filename(entry))).catch(ignoreMissing);
      return stat?.isFile() && stat.size === entry.size ? publicFont(entry) : null;
    }));
    return fonts.filter(Boolean);
  }

  async function listFonts() {
    const root = await directory(false);
    return root ? available(root, await manifest(root)) : [];
  }

  async function importFonts(paths) {
    if (!paths.length) return { fonts: await listFonts(), imported: 0, skipped: [] };
    const root = await directory(true);
    const index = path.join(root, 'manifest.json');
    return serialized(index, async () => {
      let entries = await manifest(root);
      const skipped = [];
      let imported = 0;
      for (const source of paths) {
        const extension = path.extname(source).slice(1).toLowerCase();
        const name = fontName(source);
        try {
          if (!acceptedExtensions.includes(extension)) throw new Error('请选择 OTF、TTF、WOFF 或 WOFF2 字体。');
          const bytes = await readRegularFile(await fs.realpath(source), maxFontBytes);
          verifyFont(bytes, extension);
          const id = digest(bytes);
          const matching = entries.find(entry => entry.id === id);
          if (matching) {
            const stored = await readRegularFile(path.join(root, filename(matching)), maxFontBytes).catch(() => null);
            if (stored?.equals(bytes)) throw new Error('此字体已导入。');
          }
          const entry = { id, name, extension, size: bytes.length };
          const destination = path.join(root, filename(entry));
          const next = [...entries.filter(font => font.id !== id), entry];
          const data = Buffer.from(JSON.stringify(next));
          if (data.length > maxManifestBytes) throw new Error('字体库索引已满。');
          await atomicWrite(destination, bytes);
          try {
            await atomicWrite(index, data);
          } catch (error) {
            await fs.unlink(destination).catch(() => {});
            throw error;
          }
          entries = next;
          imported++;
        } catch (error) {
          skipped.push({ name, reason: error.code ? '无法读取或保存此字体。' : error.message });
        }
      }
      return { fonts: await available(root, entries), imported, skipped };
    });
  }

  async function removeFont(id) {
    if (typeof id !== 'string' || !fontId.test(id)) throw new Error('字体标识无效。');
    const root = await directory(false);
    if (!root) return [];
    const index = path.join(root, 'manifest.json');
    return serialized(index, async () => {
      const entries = await manifest(root);
      const entry = entries.find(font => font.id === id);
      if (!entry) return available(root, entries);
      await fs.unlink(path.join(root, filename(entry))).catch(ignoreMissing);
      const remaining = entries.filter(font => font.id !== id);
      await atomicWrite(index, Buffer.from(JSON.stringify(remaining)));
      return available(root, remaining);
    });
  }

  async function respond(request) {
    const requestOrigin = request.headers.get('origin');
    if (requestOrigin && requestOrigin !== origin && requestOrigin !== devOrigin) return new Response(null, { status: 403 });
    const match = new URL(request.url).pathname.match(fontPath);
    if (!match || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 });
    try {
      const root = await directory(false);
      const entry = root && (await manifest(root)).find(item => item.id === match[1] && item.extension === match[2]);
      if (entry) {
        const bytes = await readRegularFile(path.join(root, filename(entry)), maxFontBytes);
        if (bytes.length === entry.size && digest(bytes) === entry.id) {
          return new Response(request.method === 'HEAD' ? null : bytes, {
            headers: {
              'Access-Control-Allow-Origin': requestOrigin || origin,
              'Cache-Control': 'no-store',
              'Content-Type': fontTypes[entry.extension].mime,
              'Content-Length': String(bytes.length),
              'X-Content-Type-Options': 'nosniff',
            },
          });
        }
      }
    } catch {
      // The profile may change while a font request is in flight.
    }
    return new Response(null, { status: 404 });
  }

  return { listFonts, importFonts, removeFont, respond };
}

module.exports = { createFontStore, acceptedExtensions, fontRoute };

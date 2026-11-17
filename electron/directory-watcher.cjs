const fs = require('node:fs');
const path = require('node:path');
const { pathKey } = require('./documents.cjs');

const MAX_DIRECTORIES = 256;
const BATCH_DELAY_MS = 120;
const POLL_INTERVAL_MS = 1_500;
const FLAT_POLL_TICKS = 3;
const MAX_FLAT_FOLDERS = 128;
const MAX_FLAT_ENTRIES = 8_192;
const NATIVE_RECURSION = process.platform === 'win32' || process.platform === 'darwin';
const OMIT_FROM_FLAT = new Set(['.git', 'node_modules']);
const PATH_SEPARATOR = process.platform === 'win32' ? /[\\/]/ : '/';

function directoryPaths(paths) {
  const result = new Map();
  for (const entry of paths.slice(0, MAX_DIRECTORIES * 4)) {
    const original = entry?.path;
    if (typeof original !== 'string' || !original.length || original.length > 32_767 || original.includes('\0') || !path.isAbsolute(original)) continue;
    if (process.platform === 'win32' && /^[\\/]{2}(?:\.[\\/]|\?[\\/](?![a-z]:[\\/]|unc[\\/]))/i.test(original)) continue;
    const absolute = path.resolve(original);
    const key = pathKey(absolute);
    let subscription = result.get(key);
    if (!subscription) {
      if (result.size === MAX_DIRECTORIES) continue;
      subscription = { original, path: absolute, recursive: false, showHidden: false, watchContentChanges: false };
      result.set(key, subscription);
    }
    subscription.recursive ||= entry.recursive === true;
    subscription.showHidden ||= entry.showHidden === true;
    subscription.watchContentChanges ||= entry.watchContentChanges === true;
  }
  return result;
}

function visibleEvent(entry, event, name) {
  if (event === 'change' && !entry.watchContentChanges) return false;
  if (!name) return true;
  return !name.toString().split(PATH_SEPARATOR).some(part =>
    (!entry.showHidden && part.startsWith('.')) || (entry.recursive && OMIT_FROM_FLAT.has(part)));
}

async function folderStamp(directory) {
  const stat = await fs.promises.stat(directory, { bigint: true }).catch(() => null);
  const identity = stat?.isDirectory() ? `${stat.dev}:${stat.ino}:${stat.birthtimeNs}` : null;
  return { identity, stamp: identity ? `${identity}:${stat.mtimeNs}:${stat.ctimeNs}` : null };
}

async function flatSnapshot(root, showHidden) {
  const result = new Map([[root, null]]);
  let entries = 0;
  for (const folder of result.keys()) {
    const { stamp } = await folderStamp(folder);
    if (!stamp) return null;
    result.set(folder, stamp);
    for await (const item of await fs.promises.opendir(folder)) {
      if (++entries > MAX_FLAT_ENTRIES) return null;
      if (!item.isDirectory() || OMIT_FROM_FLAT.has(item.name) || (!showHidden && item.name.startsWith('.'))) continue;
      if (result.size === MAX_FLAT_FOLDERS) return null;
      result.set(path.join(folder, item.name), null);
    }
  }
  return result;
}

function createDirectoryWatcher({ notify }) {
  const watched = new Map();
  const pending = new Set();
  let batch;
  let disposed = false;

  function current(entry) {
    return !disposed && watched.get(entry.key) === entry;
  }

  function markChanged(entry) {
    if (!current(entry)) return;
    pending.add(entry.key);
    if (batch) return;
    batch = setTimeout(() => {
      batch = undefined;
      const paths = [...pending].map(key => watched.get(key)?.original).filter(Boolean);
      pending.clear();
      if (!disposed && paths.length) notify({ paths });
    }, BATCH_DELAY_MS);
    batch.unref();
  }

  function closeWatch(entry) {
    const watcher = entry.watcher;
    entry.watcher = null;
    entry.nativeRecursive = false;
    watcher?.close();
  }

  function startWatch(entry, recursive) {
    try {
      const watcher = fs.watch(entry.path, { persistent: false, recursive }, (event, name) => {
        if (!current(entry) || entry.watcher !== watcher) return;
        if (!visibleEvent(entry, event, name)) return;
        markChanged(entry);
        if (event === 'rename') void inspect(entry);
      });
      entry.watcher = watcher;
      entry.nativeRecursive = recursive;
      watcher.on('error', () => {
        if (entry.watcher !== watcher) return;
        if (recursive) entry.recursionFailed = true;
        closeWatch(entry);
        markChanged(entry);
      });
      watcher.once('close', () => {
        if (entry.watcher !== watcher) return;
        entry.watcher = null;
        entry.nativeRecursive = false;
      });
      return true;
    } catch {
      // Some filesystems cannot report native events. The directory stat poll covers structural changes.
      if (recursive) entry.recursionFailed = true;
      return false;
    }
  }

  async function inspectFlat(entry) {
    if (!current(entry) || entry.flatChecking || !entry.recursive || entry.nativeRecursive || !entry.identity) return;
    const previous = entry.flatSnapshot;
    if (previous === null) {
      // Large or unreadable trees use conservative invalidation without scanning descendants forever.
      markChanged(entry);
      return;
    }
    entry.flatChecking = true;
    const { identity, showHidden } = entry;
    try {
      let changed = !previous;
      if (previous) {
        for (const [folder, stamp] of previous) {
          if ((await folderStamp(folder)).stamp === stamp) continue;
          changed = true;
          break;
        }
      }
      if (!changed || !current(entry)) return;
      const snapshot = await flatSnapshot(entry.path, showHidden).catch(() => null);
      if (!current(entry) || entry.identity !== identity || entry.showHidden !== showHidden || !entry.recursive || entry.nativeRecursive) return;
      entry.flatSnapshot = snapshot;
      markChanged(entry);
    } finally {
      entry.flatChecking = false;
    }
  }

  async function inspect(entry) {
    if (entry.checking || !current(entry)) return;
    entry.checking = true;
    try {
      const { identity, stamp } = await folderStamp(entry.path);
      if (!current(entry)) return;
      if (entry.identity !== identity) {
        closeWatch(entry);
        entry.recursionFailed = false;
        entry.flatSnapshot = undefined;
        markChanged(entry);
      } else if (entry.stamp !== stamp) markChanged(entry);
      entry.identity = identity;
      entry.stamp = stamp;
      if (identity && !entry.watcher &&
          !(entry.recursive && NATIVE_RECURSION && !entry.recursionFailed && startWatch(entry, true))) {
        startWatch(entry, false);
      }
      if (entry.flatSnapshot === undefined) void inspectFlat(entry);
    } finally {
      entry.checking = false;
    }
  }

  function refresh() {
    for (const entry of watched.values()) {
      markChanged(entry);
      void inspect(entry);
    }
  }

  let ticks = 0;
  const poll = setInterval(() => {
    const checkFlat = ++ticks % FLAT_POLL_TICKS === 0;
    for (const entry of watched.values()) {
      void inspect(entry);
      if (checkFlat) void inspectFlat(entry);
    }
  }, POLL_INTERVAL_MS);
  poll.unref();

  function setPaths(paths) {
    if (disposed || !Array.isArray(paths)) return;
    const next = directoryPaths(paths);
    for (const [key, entry] of watched) {
      if (next.has(key)) continue;
      watched.delete(key);
      pending.delete(key);
      closeWatch(entry);
    }
    for (const [key, subscription] of next) {
      const existing = watched.get(key);
      if (existing) {
        const flatSettingsChanged = existing.recursive !== subscription.recursive || existing.showHidden !== subscription.showHidden;
        if (existing.recursive !== subscription.recursive) {
          closeWatch(existing);
          existing.recursionFailed = false;
        }
        if (flatSettingsChanged) existing.flatSnapshot = undefined;
        Object.assign(existing, subscription);
        if (flatSettingsChanged) markChanged(existing);
        if (!existing.watcher || flatSettingsChanged) void inspect(existing);
      } else {
        const entry = { key, ...subscription };
        watched.set(key, entry);
        void inspect(entry);
      }
    }
    if (!pending.size) {
      clearTimeout(batch);
      batch = undefined;
    }
  }

  function dispose() {
    setPaths([]);
    disposed = true;
    clearInterval(poll);
  }

  return { setPaths, refresh, dispose };
}

module.exports = { createDirectoryWatcher };

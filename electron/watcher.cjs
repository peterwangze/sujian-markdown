const fs = require('node:fs');
const path = require('node:path');
const { getDocument, pathKey } = require('./documents.cjs');

function createWatcher({ knownDocuments, notify }) {
  const files = new Map();
  let disposed = false;

  async function check(entry, force) {
    if (entry.busy || disposed) {
      entry.retry ||= force;
      return;
    }
    entry.busy = true;
    try {
      const stat = await fs.promises.stat(entry.path).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      const stamp = stat ? `${stat.mtimeMs}:${stat.size}:${stat.ino}` : 'missing';
      if (!force && stamp === entry.stamp) return;
      const document = stat ? await getDocument(entry.path).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      }) : null;
      if (disposed || files.get(entry.key) !== entry) return;
      entry.stamp = stamp;
      const hash = document?.hash ?? null;
      if (hash !== entry.hash) {
        entry.hash = hash;
        if (document) knownDocuments.set(pathKey(document.path), { hash: document.hash });
        notify({ path: entry.path, document });
      }
    } catch (error) {
      if (entry.lastError !== error.message) console.warn(`Could not refresh ${entry.path}: ${error.message}`);
      entry.lastError = error.message;
    } finally {
      entry.busy = false;
      if (entry.retry) {
        entry.retry = false;
        void check(entry, true);
      }
    }
  }

  let ticks = 0;
  const poll = setInterval(() => {
    ticks += 1;
    for (const entry of files.values()) void check(entry, ticks % 15 === 0);
  }, 2000);
  poll.unref();

  function setPaths(paths) {
    const next = new Set();
    for (const filePath of paths) {
      const key = pathKey(filePath);
      next.add(key);
      if (files.has(key) || !knownDocuments.has(key)) continue;
      const entry = { key, path: filePath, hash: knownDocuments.get(key).hash };
      files.set(key, entry);
      try {
        entry.watcher = fs.watch(path.dirname(filePath), { persistent: false }, (event, name) => {
          if (name && pathKey(path.join(path.dirname(filePath), name.toString())) !== key) return;
          clearTimeout(entry.timer);
          entry.timer = setTimeout(() => void check(entry, true), 120);
        });
        entry.watcher.on('error', () => entry.watcher.close());
      } catch {
        // Polling covers network folders without filesystem notifications.
      }
      void check(entry, true);
    }
    for (const [key, entry] of files) {
      if (next.has(key)) continue;
      clearTimeout(entry.timer);
      entry.watcher?.close();
      files.delete(key);
    }
  }

  return {
    setPaths,
    refresh() {
      for (const entry of files.values()) void check(entry, true);
    },
    saved(document) {
      const entry = files.get(pathKey(document.path));
      if (entry) entry.hash = document.hash;
    },
    dispose() {
      disposed = true;
      clearInterval(poll);
      setPaths([]);
    },
  };
}

module.exports = { createWatcher };

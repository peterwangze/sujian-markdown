const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { documentExtension } = require('./documents.cjs');

async function listDirectory(directory, { showHidden = false, showAllFiles = false } = {}) {
  const absolute = path.resolve(directory);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (!showHidden && entry.name.startsWith('.')) continue;
    const folder = entry.isDirectory();
    if (!folder && (!entry.isFile() || (!showAllFiles && !documentExtension.test(entry.name)))) continue;
    const fullPath = path.join(absolute, entry.name);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (stat) {
      result.push({
        name: entry.name, path: fullPath, kind: folder ? 'directory' : 'file',
        mtimeMs: stat.mtimeMs, createdMs: stat.birthtimeMs,
      });
    }
  }
  const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return result.sort((left, right) => left.kind.localeCompare(right.kind) || names.compare(left.name, right.name));
}

function searchDirectory(options, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const archived = path.join(__dirname, 'workspace-search.cjs');
    const unpacked = archived.replace(/([\\/])app\.asar([\\/])/i, '$1app.asar.unpacked$2');
    const worker = new Worker(existsSync(unpacked) ? unpacked : archived, { workerData: options });
    let finished = false;
    function finish(error, result) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result);
    }
    function cancel() {
      finish(null, { matches: [], truncated: false, cancelled: true });
    }
    const timeout = setTimeout(() => finish(new Error('Search took too long. Narrow the search or simplify the regular expression.')), 15000);
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (code !== 0) finish(new Error(`Search stopped unexpectedly (exit ${code}).`));
    });
    worker.once('message', (data) => {
      if (data.error) finish(new Error(data.error));
      else finish(null, data);
    });
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}

async function findDocuments(directory, { limit = 10000, showHidden = false } = {}) {
  const found = [];
  const folders = [path.resolve(directory)];
  while (folders.length && found.length < limit) {
    const folder = folders.pop();
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch((error) => {
      if (folder === path.resolve(directory)) throw error;
      return [];
    });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      if (!showHidden && entry.name.startsWith('.')) continue;
      const filePath = path.join(folder, entry.name);
      if (entry.isDirectory()) folders.push(filePath);
      if (entry.isFile() && documentExtension.test(entry.name)) found.push({ path: filePath, name: entry.name });
      if (found.length >= limit) break;
    }
  }
  return found;
}

module.exports = { findDocuments, listDirectory, searchDirectory };

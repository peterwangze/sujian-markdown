const fs = require('node:fs/promises');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');
const { decode, documentExtension } = require('./documents.cjs');

const limit = 500;
const maxFileSize = 32 * 1024 * 1024;
const escapeRegex = (input) => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function search({ path: root, query, regex, caseSensitive, wholeWord, showHidden }) {
  if (typeof query !== 'string' || !query.length) return { matches: [], truncated: false };
  const pattern = regex ? query : escapeRegex(query);
  const source = wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])` : pattern;
  const expression = new RegExp(source, caseSensitive ? 'gu' : 'giu');
  const initial = path.resolve(root);
  const folders = [initial];
  const matches = [];
  let skipped = 0;
  while (folders.length) {
    const folder = folders.pop();
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch((error) => {
      if (folder === initial) throw error;
      skipped += 1;
      return [];
    });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      if (!showHidden && entry.name.startsWith('.')) continue;
      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        folders.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !documentExtension.test(entry.name)) continue;
      let text;
      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > maxFileSize) {
          skipped += 1;
          continue;
        }
        text = decode(await fs.readFile(fullPath)).text;
      } catch {
        skipped += 1;
        continue;
      }
      const lines = text.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        expression.lastIndex = 0;
        const match = expression.exec(line);
        if (!match) continue;
        if (matches.length >= limit) return { matches, skipped, truncated: true };
        const snippetStart = Math.max(0, match.index - 75);
        const snippetEnd = Math.min(line.length, match.index + Math.min(match[0].length, 140) + 125);
        const prefix = snippetStart > 0 ? '…' : '';
        const suffix = snippetEnd < line.length ? '…' : '';
        matches.push({ path: fullPath, name: entry.name, line: index + 1, column: match.index + 1, text: prefix + line.slice(snippetStart, snippetEnd) + suffix });
      }
    }
  }
  return { matches, skipped, truncated: false };
}

search(workerData).then((result) => parentPort.postMessage(result), (error) => parentPort.postMessage({ error: error.message }));

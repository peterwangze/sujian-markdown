const fs = require('node:fs/promises');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');
const { decode, documentExtension } = require('./documents.cjs');

const limit = 500;
const maxFileSize = 32 * 1024 * 1024;
const escapeRegex = (input) => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function codePointBoundary(text, index, offset) {
  const unit = text.charCodeAt(index);
  const previous = text.charCodeAt(index - 1);
  if (unit >= 0xdc00 && unit <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff) return index + offset;
  return index;
}

function matchingLine(line, first, rest) {
  const start = codePointBoundary(line, Math.max(0, first.index - 75), -1);
  const end = codePointBoundary(line, Math.min(line.length, first.index + Math.min(first[0].length, 140) + 125), 1);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < line.length ? '…' : '';
  const highlights = [];
  let occurrences = 0;
  for (let match = first; match; match = rest.next().value) {
    occurrences += 1;
    if (!match[0].length || match.index >= end) continue;
    const from = prefix.length + match.index - start;
    const to = prefix.length + Math.min(end, match.index + match[0].length) - start;
    highlights.push({ from, to });
  }
  return { column: first.index + 1, text: prefix + line.slice(start, end) + suffix, highlights, occurrences };
}

async function search({ path: root, query, regex, caseSensitive, wholeWord, showHidden }) {
  if (typeof query !== 'string' || !query.length) return { matches: [], occurrences: 0, truncated: false };
  const pattern = regex ? query : escapeRegex(query);
  const source = wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])` : pattern;
  const expression = new RegExp(source, caseSensitive ? 'gu' : 'giu');
  const initial = path.resolve(root);
  const folders = [initial];
  const matches = [];
  let occurrences = 0;
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
        const first = expression.exec(line);
        if (!first) continue;
        if (matches.length >= limit) return { matches, occurrences, skipped, truncated: true };
        const hits = line.matchAll(expression);
        // matchAll advances past empty matches using the regex's Unicode mode.
        if (!first[0].length) hits.next();
        const result = matchingLine(line, first, hits);
        occurrences += result.occurrences;
        matches.push({ path: fullPath, name: entry.name, line: index + 1, ...result });
      }
    }
  }
  return { matches, occurrences, skipped, truncated: false };
}

search(workerData).then((result) => parentPort.postMessage(result), (error) => parentPort.postMessage({ error: error.message }));

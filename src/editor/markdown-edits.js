import { diffChars } from 'diff';

function changedRanges(parts) {
  const ranges = [];
  let before = 0;
  let after = 0;
  let change = null;

  for (const part of parts) {
    if (part.added || part.removed) {
      change ??= { before, after, endBefore: before, endAfter: after, inserted: '' };
      if (part.removed) before += part.value.length;
      if (part.added) {
        after += part.value.length;
        change.inserted += part.value;
      }
      change.endBefore = before;
      change.endAfter = after;
      continue;
    }
    if (change) ranges.push(change);
    change = null;
    before += part.value.length;
    after += part.value.length;
  }

  if (change) ranges.push(change);
  return ranges;
}

function rawOffset(raw, ranges, offset, side) {
  let adjustment = 0;

  for (const range of ranges) {
    if (offset < range.after) break;
    if (range.after === range.endAfter && offset === range.after) {
      const removed = raw.slice(range.before, range.endBefore);
      return side === 'left' || /^\s+$/.test(removed) ? range.before : range.endBefore;
    }
    if (offset < range.endAfter) {
      const fraction = (offset - range.after) / (range.endAfter - range.after);
      return range.before + Math.round(fraction * (range.endBefore - range.before));
    }
    adjustment = range.endBefore - range.endAfter;
  }

  return offset + adjustment;
}

function projectListIndent(raw, before, normalized, change) {
  if (change.before !== change.endBefore || !/^(?:[-+*]|\d{1,9}[.)])[ \t]/.test(before.slice(change.before))) return null;
  const indent = /^(\n*)([ \t]+)$/.exec(change.inserted);
  if (!indent) return null;

  // Lute can omit a blank line between loose items. Place the new indent after
  // the original line break so it still applies to the marker on disk.
  for (const range of normalized) {
    if (range.after !== change.before || range.endAfter !== range.after) continue;
    const removed = raw.slice(range.before, range.endBefore);
    if (!/^(?:\r\n|\n|\r)+$/.test(removed)) return null;
    const existing = removed.match(/\r\n|\n|\r/g).length;
    const extra = '\n'.repeat(Math.max(0, indent[1].length - existing));
    return { start: range.before, end: range.endBefore, text: removed + extra + indent[2] };
  }
  return null;
}

export function projectMarkdownEdit(raw, before, after) {
  if (before === after) return raw;
  if (before === raw) return after;

  // Avoid aligning each carriage return individually in a Windows document.
  if (raw.includes('\r\n') && !/(?:^|[^\r])\n|\r(?!\n)/.test(raw) && !before.includes('\r') && !after.includes('\r')) {
    const unix = projectMarkdownEdit(raw.replaceAll('\r\n', '\n'), before, after);
    return unix.replaceAll('\n', '\r\n');
  }

  const normalized = changedRanges(diffChars(raw, before));
  const changes = changedRanges(diffChars(before, after));
  let result = '';
  let cursor = 0;

  for (const change of changes) {
    const indent = projectListIndent(raw, before, normalized, change);
    if (indent) {
      result += raw.slice(cursor, indent.start) + indent.text;
      cursor = indent.end;
      continue;
    }
    const start = rawOffset(raw, normalized, change.before, 'right');
    const end = Math.max(start, rawOffset(raw, normalized, change.endBefore, 'left'));
    const generatedEof = start === raw.length && normalized.find((range) =>
      range.before === range.endBefore && range.endAfter === change.before && /^\n+$/.test(range.inserted));
    const prefix = generatedEof && change.inserted ? generatedEof.inserted : '';
    result += raw.slice(cursor, start) + prefix + change.inserted;
    cursor = end;
  }

  return result + raw.slice(cursor);
}

export function matchMarkdown(text, query, options = {}) {
  if (!query) return [];

  const escaped = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = options.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${escaped})(?![\\p{L}\\p{N}_])` : escaped;
  const flags = options.caseSensitive ? 'gu' : 'giu';

  try {
    return Array.from(text.matchAll(new RegExp(pattern, flags)));
  } catch {
    return [];
  }
}

export function replacementText(match, replacement, regex) {
  if (!regex) return replacement;

  return replacement.replace(/\$(\$|&|\d{1,2}|<[^>]+>)/g, (token, group) => {
    if (group === '$') return '$';
    if (group === '&') return match[0];
    if (group.startsWith('<')) return match.groups ? match.groups[group.slice(1, -1)] ?? '' : token;
    const index = Number(group);
    if (index > 0 && index < match.length) return match[index] ?? '';
    const firstDigit = Number(group[0]);
    if (group.length === 2 && firstDigit > 0 && firstDigit < match.length) {
      return (match[firstDigit] ?? '') + group[1];
    }
    return token;
  });
}

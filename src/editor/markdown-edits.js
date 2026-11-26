import { diffArrays, diffChars } from 'diff';

// jsdiff compares characters in O(N·D), which freezes on a long document that
// differs in many places. Longer texts are aligned by line first, and only
// each changed run is then compared character by character.
const inlineLimit = 8000;
const refineLimit = 4_000_000;
const linePattern = /[^\n]*\n|[^\n]+$/g;
// Aligning lines takes (old + new) × differences steps at most, so halves of
// the lines are aligned on their own where that bound is too high. A
// comparison of characters that takes too long reports the texts as replaced.
const alignCost = 250_000;
const compareTime = 30;
// A run without line breaks that changed in places far apart is split where
// both texts are the same until the pieces are small enough to compare. Pieces
// that no longer run side by side, and comparisons that gave up, are reported
// as replaced without more time being spent.
const probeLength = 24;
const splitPoints = [0.5, 0.625, 0.375, 0.75, 0.25, 0.875, 0.125];
const timeoutsAllowed = 4;

function replaced(before, after) {
  return [
    ...(before ? [{ value: before, removed: true }] : []),
    ...(after ? [{ value: after, added: true }] : []),
  ];
}

// Where two long texts are the same near their middle, as the place in the
// older text and the matching place in the newer one, or null.
function shared(before, after) {
  const slack = Math.max(64, before.length >> 2);
  for (const share of splitPoints) {
    const at = Math.floor(before.length * share);
    const probe = before.slice(at, at + probeLength);
    const place = after.indexOf(probe, Math.max(0, at - 64));
    if (place >= 0 && place <= at + 64) return { at, place };
    // A text that repeats itself offers many places. The nearest is taken.
    let nearest = -1;
    for (let found = after.indexOf(probe, Math.max(0, at - slack)), seen = 0;
      found >= 0 && found <= at + slack && seen < 64; found = after.indexOf(probe, found + 1), seen += 1) {
      if (nearest < 0 || Math.abs(found - at) < Math.abs(nearest - at)) nearest = found;
    }
    if (nearest >= 0) return { at, place: nearest };
  }
  return null;
}

function compareChars(before, after, budget) {
  if (!before || !after) return replaced(before, after);
  const limit = Math.min(before.length, after.length);
  let start = 0;
  let endBefore = before.length;
  let endAfter = after.length;
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const oldText = before.slice(start, endBefore);
  const newText = after.slice(start, endAfter);
  const parts = [];
  const split = oldText && newText && oldText.length * newText.length > refineLimit &&
    budget.timeouts < timeoutsAllowed ? shared(oldText, newText) : null;
  if (start) parts.push({ value: before.slice(0, start) });
  if (split) {
    parts.push(...compareChars(oldText.slice(0, split.at), newText.slice(0, split.place), budget),
      ...compareChars(oldText.slice(split.at), newText.slice(split.place), budget));
  } else if (!oldText || !newText) {
    parts.push(...replaced(oldText, newText));
  } else if (oldText.length * newText.length <= refineLimit) {
    const compared = budget.timeouts < timeoutsAllowed ? diffChars(oldText, newText, { timeout: compareTime }) : undefined;
    if (compared) parts.push(...compared);
    else {
      budget.timeouts += 1;
      parts.push(...replaced(oldText, newText));
    }
  } else {
    parts.push(...replaced(oldText, newText));
  }
  if (endBefore < before.length) parts.push({ value: before.slice(endBefore) });
  return parts;
}

function alignLines(oldLines, newLines) {
  if ((oldLines.length + newLines.length) * Math.min(oldLines.length, newLines.length) <= alignCost) {
    return diffArrays(oldLines, newLines);
  }
  const oldMiddle = oldLines.length >> 1;
  const newMiddle = newLines.length >> 1;
  return [
    ...alignLines(oldLines.slice(0, oldMiddle), newLines.slice(0, newMiddle)),
    ...alignLines(oldLines.slice(oldMiddle), newLines.slice(newMiddle)),
  ];
}

export function diffParts(before, after) {
  if (before.length + after.length <= inlineLimit) {
    return diffChars(before, after, { timeout: compareTime }) ?? replaced(before, after);
  }
  const limit = Math.min(before.length, after.length);
  let start = 0;
  let endBefore = before.length;
  let endAfter = after.length;
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const parts = [];
  const budget = { timeouts: 0 };
  const removed = [];
  const added = [];
  const flush = () => {
    const oldText = removed.join('');
    const newText = added.join('');
    removed.length = 0;
    added.length = 0;
    parts.push(...compareChars(oldText, newText, budget));
  };
  if (start) parts.push({ value: before.slice(0, start) });
  const oldLines = before.slice(start, endBefore).match(linePattern) ?? [];
  const newLines = after.slice(start, endAfter).match(linePattern) ?? [];
  for (const part of alignLines(oldLines, newLines)) {
    if (part.removed) removed.push(...part.value);
    else if (part.added) added.push(...part.value);
    else {
      flush();
      parts.push({ value: part.value.join('') });
    }
  }
  flush();
  if (endBefore < before.length) parts.push({ value: before.slice(endBefore) });
  return parts;
}

export function diffRanges(before, after) {
  return changedRanges(diffParts(before, after));
}

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

  return applyMarkdownChanges(raw, before, diffRanges(raw, before), diffRanges(before, after));
}

// Applies edits made on the normalised text `before` to the document `raw`,
// whose differences from `before` are described by `normalized`.
export function applyMarkdownChanges(raw, before, normalized, changes) {
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

// Applies CodeMirror changes straight to a document that equals the editor text.
export function spliceChanges(raw, changes) {
  let result = '';
  let cursor = 0;
  changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
    result += raw.slice(cursor, from) + inserted.toString();
    cursor = to;
  });
  return result + raw.slice(cursor);
}

export function markdownSearchPattern(query, options = {}) {
  const escaped = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flags = options.caseSensitive ? 'gu' : 'giu';
  if (options.regex && options.wholeWord) new RegExp(query, flags);
  const pattern = options.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${escaped})(?![\\p{L}\\p{N}_])` : escaped;
  return new RegExp(pattern, flags);
}

export function matchMarkdown(text, query, options = {}) {
  if (!query) return [];

  try {
    return Array.from(text.matchAll(markdownSearchPattern(query, options)));
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

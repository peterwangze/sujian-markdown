import { syntaxTree } from '@codemirror/language';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { formatMarkdown } from './format.js';

const inlineNodes = { bold: 'StrongEmphasis', italic: 'Emphasis', 'inline-code': 'InlineCode' };
const pairedMarkup = {
  strike: [/~~(?=\S)([^\n]+?)(?<=\S)~~/g, 2],
  underline: [/<u>(.*?)<\/u>/gi, 3],
  highlight: [/==(?=\S)([^\n]+?)(?<=\S)==/g, 2],
  superscript: [/\^(?=\S)((?:\\.|[^\\^\n])+?)(?<=\S)\^/g, 1],
  subscript: [/(?<!~)~(?![~\s])((?:\\.|[^\\~\n])+?)(?<=\S)~(?!~)/g, 1],
};
const inlineFormats = new Set([...Object.keys(inlineNodes), ...Object.keys(pairedMarkup)]);

function ancestors(state, position, side) {
  const nodes = [];
  for (let node = syntaxTree(state).resolveInner(position, side); node; node = node.parent) nodes.push(node);
  return nodes;
}

function inlineDelimiters(state, command, from, to) {
  const type = inlineNodes[command];
  const pair = pairedMarkup[command];
  if (!type && !pair) return null;
  const nodes = [...ancestors(state, from, 1), ...ancestors(state, from, -1)];
  const matching = nodes.find(node => node.name === type && node.to >= to);
  let changes;
  if (matching) {
    const start = matching.firstChild;
    const end = matching.lastChild;
    if (!start || !end || start.to > end.from || (from === to && (from < start.to || to > end.from))) return null;
    changes = [{ from: start.from, to: start.to }, { from: end.from, to: end.to }];
    if (command === 'inline-code' && /^ .*\S.* $/s.test(state.sliceDoc(start.to, end.from))) {
      changes[0].to++;
      changes[1].from--;
    }
  } else if (pair && !nodes.some(node => /^(?:CodeBlock|FencedCode|InlineCode)$/.test(node.name))) {
    const line = state.doc.lineAt(from);
    const [pattern, openLength] = pair;
    for (const match of line.text.matchAll(pattern)) {
      const [text, content] = match;
      const { index } = match;
      const start = line.from + index;
      const end = start + text.length;
      if (start > from || end < to || /(?:^|[^\\])(?:\\\\)*\\$/.test(line.text.slice(0, index))) continue;
      const contentStart = start + openLength;
      const contentEnd = contentStart + content.length;
      if (from === to && (from < contentStart || to > contentEnd)) continue;
      changes = [{ from: start, to: contentStart }, { from: contentEnd, to: end }];
      break;
    }
  }
  return changes;
}

export function removeSourceInlineFormat(view, command) {
  const { state } = view;
  const { from, to, anchor } = state.selection.main;
  const delimiters = inlineDelimiters(state, command, from, to);
  if (!delimiters) return false;
  const [opening, closing] = delimiters;
  if (from < to && from >= opening.to && to <= closing.from && (from > opening.to || to < closing.from)) {
    const restyle = text => text ? formatMarkdown(command, undefined, text)?.text ?? text : '';
    const before = restyle(state.sliceDoc(opening.to, from));
    const selected = state.sliceDoc(from, to);
    const after = restyle(state.sliceDoc(to, closing.from));
    const start = opening.from + before.length;
    const end = start + selected.length;
    view.dispatch({
      changes: { from: opening.from, to: closing.to, insert: before + selected + after },
      selection: anchor === from ? { anchor: start, head: end } : { anchor: end, head: start },
      scrollIntoView: true,
      userEvent: 'input.format',
    });
  } else {
    view.dispatch({ changes: delimiters, scrollIntoView: true, userEvent: 'input.format' });
  }
  return true;
}

function inlineContent(node) {
  if (['Paragraph', 'TableCell'].includes(node.name)) return [node.from, node.to];
  if (node.name === 'Task') return [node.firstChild.to, node.to];
  if (node.name.startsWith('ATXHeading')) {
    const [open, close] = node.getChildren('HeaderMark');
    return [open.to, close?.from ?? node.to];
  }
  if (node.name.startsWith('SetextHeading')) return [node.from, node.getChild('HeaderMark').from];
  return null;
}

export function formatSourceInlineSelection(view, command) {
  if (!inlineFormats.has(command)) return false;
  const { state } = view;
  const { from, to } = state.selection.main;
  const startLine = state.doc.lineAt(from);
  const endLine = state.doc.lineAt(to);
  if (startLine.number === endLine.number && !state.sliceDoc(from, to).includes('|')) {
    return ancestors(state, from, 1).some(node =>
      /^(?:CodeBlock|FencedCode)$/.test(node.name) && node.to >= to);
  }

  // Delimiters cannot span separate Markdown blocks, table cells, or list items.
  // The GFM tree identifies each text segment without including its structural marks.
  const ranges = [];
  markdownLanguage.parser.parse(state.doc.toString()).iterate({ from, to, enter(ref) {
    const bounds = inlineContent(ref.node);
    if (!bounds) return;
    const [start, end] = bounds;
    for (let number = state.doc.lineAt(Math.max(start, from)).number; number <= endLine.number; number++) {
      const line = state.doc.line(number);
      if (line.from >= end) break;
      const prefix = /^(?:[ \t]*>[ \t]?)+/.exec(line.text)?.[0].length ?? 0;
      const left = Math.max(start, from, line.from + prefix);
      const right = Math.min(end, to, line.to);
      if (right <= left) continue;
      const text = state.sliceDoc(left, right);
      const content = text.trim();
      if (!content) continue;
      const contentFrom = left + text.length - text.trimStart().length;
      ranges.push({ from: contentFrom, to: contentFrom + content.length, content });
    }
    return false;
  } });
  const delimiters = ranges.map(range => inlineDelimiters(state, command, range.from, range.to));
  const removals = new Map(delimiters.filter(Boolean).flat().map(change => [`${change.from}:${change.to}`, change]));
  const changes = delimiters.every(Boolean) ? [...removals.values()] : ranges.flatMap((range, index) =>
    delimiters[index] ? [] : [{ from: range.from, to: range.to, insert: formatMarkdown(command, undefined, range.content).text }]);
  if (changes.length) view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.format' });
  return true;
}

export function setSourceHeading(view, level) {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  const nodes = [...ancestors(state, from, 1), ...ancestors(state, from, -1)];
  if (nodes.some(node => node.name === 'CodeBlock' || node.name === 'FencedCode')) return false;
  const heading = nodes.find(node => /^(?:ATX|Setext)Heading[1-6]$/.test(node.name));
  const marker = level ? `${'#'.repeat(level)} ` : '';
  let changes;
  if (heading?.name.startsWith('ATX')) {
    const opening = heading.getChild('HeaderMark');
    const contentStart = opening.to + /^[ \t]*/.exec(state.sliceDoc(opening.to, heading.to))[0].length;
    changes = [{ from: opening.from, to: contentStart, insert: marker }];
    const closing = heading.getChildren('HeaderMark')[1];
    if (!level && closing) {
      const trailing = /[ \t]*$/.exec(state.sliceDoc(contentStart, closing.from))[0].length;
      changes.push({ from: closing.from - trailing, to: heading.to });
    }
  } else if (heading) {
    const underline = heading.getChild('HeaderMark');
    const contentEnd = state.doc.line(state.doc.lineAt(underline.from).number - 1).to;
    const text = state.sliceDoc(heading.from, contentEnd);
    changes = level
      ? [{ from: heading.from, to: heading.to, insert: marker + text.replace(/\n[ \t>]*/g, ' ') }]
      : [{ from: contentEnd, to: heading.to }];
  } else if (level) {
    const paragraph = nodes.find(node => node.name === 'Paragraph' && node.from >= line.from);
    changes = { from: paragraph?.from ?? line.from, insert: marker };
  }
  if (!changes) return false;
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.format' });
  return true;
}

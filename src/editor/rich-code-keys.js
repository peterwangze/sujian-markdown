import { offsetAt, pointAt } from './rich-text-range.js';

const codeSelector = '[data-type="code-block"] > pre.vditor-ir__marker--pre > code';
const indentSize = 4;
const indent = ' '.repeat(indentSize);

function codeAt(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest(codeSelector);
}

function shiftCodeLines(text, from, to, outdent) {
  const first = from > 0 ? text.lastIndexOf('\n', from - 1) + 1 : 0;
  const last = to > from && text[to - 1] === '\n' ? to - 1 : to;
  const end = text.indexOf('\n', last);
  const boundary = end === -1 ? text.length : end;
  let lineStart = first;
  let mappedFrom = from;
  let mappedTo = to;
  const shifted = text.slice(first, boundary).split('\n').map(line => {
    if (outdent) {
      const leading = /^(?: {0,3}\t| {1,4})/.exec(line)?.[0].length ?? 0;
      mappedFrom -= Math.min(leading, Math.max(0, from - lineStart));
      mappedTo -= Math.min(leading, Math.max(0, to - lineStart));
      lineStart += line.length + 1;
      return line.slice(leading);
    }
    if (lineStart < from) mappedFrom += indentSize;
    if (lineStart < to) mappedTo += indentSize;
    lineStart += line.length + 1;
    return indent + line;
  }).join('\n');
  return { text: text.slice(0, first) + shifted + text.slice(boundary), from: mappedFrom, to: mappedTo };
}

export function handleRichCodeKeys(event, editable) {
  if ((event.key !== 'Tab' && event.key !== 'Backspace') || event.ctrlKey || event.metaKey || event.altKey) return false;
  const doc = editable.ownerDocument;
  const selection = doc.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  const code = codeAt(range.startContainer);
  if (!code || code !== codeAt(range.endContainer) || !editable.contains(code)) return false;

  const from = offsetAt(code, range.startContainer, range.startOffset);
  const to = offsetAt(code, range.endContainer, range.endOffset);
  const text = code.textContent;
  const keepFence = event.key === 'Backspace' && !event.shiftKey && selection.isCollapsed &&
    from === 0 && text !== '' && text !== '\n';
  if (event.key === 'Backspace' && !keepFence) return false;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (keepFence) return true;

  const next = !event.shiftKey && selection.isCollapsed
    ? { text: text.slice(0, from) + '\t' + text.slice(to), from: from + 1, to: from + 1 }
    : shiftCodeLines(text, from, to, event.shiftKey);
  if (next.text === text) return true;
  const backward = !selection.isCollapsed &&
    (selection.anchorNode !== range.startContainer || selection.anchorOffset !== range.startOffset);

  // Vditor reparses the code block on input and records the edit in its undo history.
  code.textContent = next.text;
  selection.collapse(...pointAt(code, next.from));
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  const renderedCode = codeAt(selection.anchorNode);
  if (renderedCode && editable.contains(renderedCode)) {
    const start = pointAt(renderedCode, next.from);
    const end = pointAt(renderedCode, next.to);
    selection.setBaseAndExtent(...(backward ? end : start), ...(backward ? start : end));
  }
  return true;
}

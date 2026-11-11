const indent = '  ';

function pointAt(code, offset) {
  const walker = code.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (offset <= node.length) return [node, offset];
    offset -= node.length;
  }
  return [code, code.childNodes.length];
}

export function handleRichCodeKeys(event, editable) {
  if ((event.key !== 'Tab' && event.key !== 'Backspace') || event.ctrlKey || event.metaKey || event.altKey) return false;
  const selection = editable.ownerDocument.getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount) return false;
  const { anchorNode } = selection;
  const anchor = anchorNode?.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode?.parentElement;
  const code = anchor?.closest('[data-type="code-block"] > pre.vditor-ir__marker--pre > code');
  if (!code || !editable.contains(code)) return false;

  const prefix = selection.getRangeAt(0).cloneRange();
  prefix.setStart(code, 0);
  const offset = prefix.toString().length;
  const text = code.textContent;
  const keepFence = event.key === 'Backspace' && !event.shiftKey && offset === 0 && text !== '' && text !== '\n';
  if (event.key === 'Backspace' && !keepFence) return false;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (keepFence) return true;

  // Use Chromium's edit commands so Vditor receives the same input and undo events as typing.
  const doc = editable.ownerDocument;
  if (!event.shiftKey) {
    doc.execCommand('insertText', false, indent);
    return true;
  }

  const lineStart = text.slice(0, offset).lastIndexOf('\n') + 1;
  const leading = text.slice(lineStart).match(/^\t|^ {1,2}/)?.[0];
  if (!leading) return true;
  const indentEnd = lineStart + leading.length;
  const replacement = text.slice(indentEnd, offset);
  const range = doc.createRange();
  range.setStart(...pointAt(code, lineStart));
  range.setEnd(...pointAt(code, Math.max(offset, indentEnd)));
  selection.removeAllRanges();
  selection.addRange(range);
  if (replacement) doc.execCommand('insertText', false, replacement);
  else doc.execCommand('delete');
  return true;
}

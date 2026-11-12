import { offsetAt, pointAt } from './rich-text-range.js';

function paragraphAt(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const paragraph = element?.closest('p[data-block="0"]');
  return paragraph && !paragraph.closest('li, table, [contenteditable="false"]') ? paragraph : null;
}

function breakBlockAt(node, editable) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const excluded = element?.closest('pre, code, table, .vditor-ir__marker, .vditor-ir__preview, [contenteditable="false"]');
  if (excluded && excluded !== editable) return null;
  return element?.closest('p[data-block="0"], li');
}

export function handleRichHardBreak(event, editable, engine) {
  if (event.key !== 'Enter' || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  const doc = editable.ownerDocument;
  const selection = doc.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  const block = breakBlockAt(range.startContainer, editable);
  if (!block || block !== breakBlockAt(range.endContainer, editable) || !editable.contains(block)) return false;

  event.preventDefault();
  event.stopImmediatePropagation();
  const marker = doc.createElement('span');
  marker.className = 'vditor-ir__node';
  marker.dataset.type = 'html-inline';
  marker.dataset.sujianBreak = '';
  const source = doc.createElement('code');
  source.className = 'vditor-ir__marker';
  // Lute serializes an editable DOM <br> as a soft break. Its HTML marker
  // preserves an explicit break even before the user types the next line.
  source.textContent = '<br>';
  marker.append(source);
  range.deleteContents();
  range.insertNode(marker);
  const caret = doc.createTextNode('\u200b');
  marker.after(caret);
  selection.collapse(caret, caret.length);
  engine.ir.preventInput = true;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertLineBreak' }));
  return true;
}

export function handleRichParagraphKeys(event, editable) {
  if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return false;
  const doc = editable.ownerDocument;
  const selection = doc.getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount) return false;
  const { anchorNode, anchorOffset } = selection;
  const paragraph = paragraphAt(anchorNode);
  if (!paragraph || !editable.contains(paragraph)) return false;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (!event.shiftKey) {
    // Preserve paragraph indentation in Markdown without creating an indented code block.
    doc.execCommand('insertText', false, '\u00a0'.repeat(4));
    return true;
  }

  const offset = offsetAt(paragraph, anchorNode, anchorOffset);
  const text = paragraph.textContent;
  const lineStart = offset > 0 ? text.lastIndexOf('\n', offset - 1) + 1 : 0;
  const leading = /^(?:\t| {1,2}|\u00a0{1,4})/.exec(text.slice(lineStart))?.[0];
  if (!leading) return true;

  selection.setBaseAndExtent(...pointAt(paragraph, lineStart), ...pointAt(paragraph, lineStart + leading.length));
  doc.execCommand('delete');
  const rendered = paragraphAt(selection.anchorNode);
  if (rendered && editable.contains(rendered)) {
    selection.collapse(...pointAt(rendered, Math.max(lineStart, offset - leading.length)));
  }
  return true;
}

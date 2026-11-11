import { offsetAt, pointAt } from './rich-text-range.js';

function paragraphAt(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const paragraph = element?.closest('p[data-block="0"]');
  return paragraph && !paragraph.closest('li, table, [contenteditable="false"]') ? paragraph : null;
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

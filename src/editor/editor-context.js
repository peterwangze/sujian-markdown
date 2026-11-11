import { syntaxTree } from '@codemirror/language';
import { codeFenceAt } from './CodeLanguageControl.jsx';

const words = new Intl.Segmenter(undefined, { granularity: 'word' });

function anchorRect(range, fallback) {
  const rect = range?.getClientRects()[0] ?? fallback.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
}

export function sourceContext(event, view, keyboard) {
  const { state } = view;
  let selection = state.selection;
  const position = keyboard ? selection.main.head : view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position !== null && (position < selection.main.from || position > selection.main.to)) {
    view.dispatch({ selection: { anchor: position } });
    selection = view.state.selection;
  }
  const coordinates = keyboard ? view.coordsAtPos(selection.main.head) : null;
  let codeText, href;
  for (let node = syntaxTree(state).resolveInner(position ?? selection.main.head, -1); node; node = node.parent) {
    if (node.name === 'FencedCode') {
      codeText = node.getChildren('CodeText').map(part => state.sliceDoc(part.from, part.to)).join('\n');
      break;
    }
    if (node.name === 'Link' || node.name === 'Autolink') {
      const url = node.getChild('URL');
      if (url) href = state.sliceDoc(url.from, url.to);
      break;
    }
  }
  return {
    view, doc: state.doc, sourceSelection: selection,
    selection: !selection.main.empty, editable: true, href, codeText,
    kind: codeText !== undefined ? 'code' : href ? 'link' : 'text',
    position: coordinates ? { x: coordinates.left, y: coordinates.bottom } : undefined,
  };
}

export function domContext(event, root, editable, keyboard) {
  const document = root.ownerDocument;
  const selection = document.getSelection();
  let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (range && (!root.contains(range.startContainer) || !root.contains(range.endContainer))) range = null;

  if (!keyboard && ![...(range?.getClientRects() ?? [])].some(rect =>
    event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)) {
    const point = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (point && root.contains(point.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(point);
      range = point;
    }
  }

  const start = keyboard && range ? range.startContainer : event.target;
  const element = start?.nodeType === Node.ELEMENT_NODE ? start : start?.parentElement;
  const block = codeFenceAt(element);
  const code = block?.querySelector(':scope > pre.vditor-ir__marker--pre > code') ?? element?.closest('pre > code');
  const cell = element?.closest('td, th');
  const href = element?.closest('a[href]')?.getAttribute('href') ||
    element?.closest('[data-type="a"]')?.querySelector('.vditor-ir__marker--link')?.textContent.replace(/^\u200b/, '').trim();
  return {
    root, range: range?.cloneRange(), editable, href, block, cell,
    selection: Boolean(range && !range.collapsed),
    backward: range && !range.collapsed &&
      (selection.anchorNode !== range.startContainer || selection.anchorOffset !== range.startOffset),
    codeText: code?.textContent,
    kind: code ? 'code' : cell ? 'table' : href ? 'link' : 'text',
    position: keyboard ? anchorRect(range, root) : undefined,
  };
}

export function restoreEditorContext(context) {
  if (context.view) {
    if (context.view.state.doc !== context.doc) return false;
    context.view.focus();
    context.view.dispatch({ selection: context.sourceSelection });
    return true;
  }
  const { root, range, backward } = context;
  if (!root.isConnected || (range && (!root.contains(range.startContainer) || !root.contains(range.endContainer)))) return false;
  root.focus({ preventScroll: true });
  const selection = root.ownerDocument.getSelection();
  if (range) {
    selection.setBaseAndExtent(
      ...(backward ? [range.endContainer, range.endOffset, range.startContainer, range.startOffset] :
        [range.startContainer, range.startOffset, range.endContainer, range.endOffset]),
    );
  } else if (context.editable) {
    selection.collapse(root, 0);
  }
  return true;
}

export function spellingAt(range, getSuggestions) {
  if (!range?.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE || !getSuggestions) return null;
  const { startContainer: node, startOffset } = range;
  const segment = words.segment(node.data).containing(Math.min(startOffset, node.length - 1));
  if (!segment?.isWordLike || segment.segment.length > 64) return null;
  const word = segment.segment;
  const suggestions = getSuggestions(word);
  if (!suggestions) return null;
  const wordRange = range.cloneRange();
  wordRange.setStart(node, segment.index);
  wordRange.setEnd(node, segment.index + word.length);
  return { word, range: wordRange, suggestions: suggestions.slice(0, 5) };
}

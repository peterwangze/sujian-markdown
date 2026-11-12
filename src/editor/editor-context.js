import { syntaxTree } from '@codemirror/language';
import { codeFenceAt } from './CodeLanguageControl.jsx';

const words = new Intl.Segmenter(undefined, { granularity: 'word' });

function containsPoint(rect, { x, y }) {
  return rect && rect.left < rect.right && rect.top < rect.bottom &&
    x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

function sourceSelectionHit(view, range, position, point) {
  if (range.empty || position === null || position < range.from || position > range.to) return false;
  if (!containsPoint(view.scrollDOM.getBoundingClientRect(), point)) return false;
  // drawSelection also highlights the blank space covered by selected newlines.
  for (const box of view.scrollDOM.querySelectorAll('.cm-selectionLayer .cm-selectionBackground')) {
    if (containsPoint(box.getBoundingClientRect(), point)) return true;
  }
  return [position - 1, position].some(offset => offset >= range.from && offset < range.to &&
    containsPoint(view.coordsForChar(offset), point));
}

function domSelection(root) {
  const selection = root.ownerDocument.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return { root, range: null };
  return { root, range: range.cloneRange(), backward: !range.collapsed &&
    (selection.anchorNode !== range.startContainer || selection.anchorOffset !== range.startOffset) };
}

function adjacentText(node, offset) {
  if (node.nodeType === Node.TEXT_NODE) return [node];
  const textAtEdge = (child, after) => {
    while (child && child.nodeType !== Node.TEXT_NODE) child = after ? child.firstChild : child.lastChild;
    return child;
  };
  return [textAtEdge(node.childNodes[offset], true), textAtEdge(node.childNodes[offset - 1], false)];
}

function domSelectionHit(range, caret, point) {
  if (!range || range.collapsed || !caret) return false;
  return adjacentText(caret.startContainer, caret.startOffset).some(node => {
    if (!node || !range.intersectsNode(node)) return false;
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.length;
    if (from >= to) return false;
    const text = node.ownerDocument.createRange();
    text.setStart(node, from);
    text.setEnd(node, to);
    return Array.from(text.getClientRects()).some(rect => containsPoint(rect, point));
  });
}

function anchorRect(range, fallback) {
  const rect = range?.getClientRects()[0] ?? fallback.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
}

export function contextSelection({ root, view }) {
  return view ? { view, doc: view.state.doc, sourceSelection: view.state.selection } : domSelection(root);
}

export function sourceContext(event, view, keyboard, snapshot) {
  const { state } = view;
  let selection = snapshot?.view === view && snapshot.doc === state.doc ? snapshot.sourceSelection : state.selection;
  const point = { x: event.clientX, y: event.clientY };
  const precise = keyboard ? null : view.posAtCoords(point);
  const hit = !keyboard && sourceSelectionHit(view, selection.main, precise, point);
  const position = keyboard ? selection.main.head : precise ?? view.posAtCoords(point, false);
  if (!keyboard) {
    const next = hit ? selection : { anchor: position };
    if (hit ? !state.selection.eq(selection) : !state.selection.main.empty || state.selection.main.head !== position) {
      view.dispatch({ selection: next });
    }
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

export function domContext(event, root, editable, keyboard, snapshot) {
  const document = root.ownerDocument;
  const selection = document.getSelection();
  let { range, backward } = snapshot?.root === root ? snapshot : domSelection(root);
  if (range && (!root.contains(range.startContainer) || !root.contains(range.endContainer))) range = null;

  if (!keyboard) {
    const point = { x: event.clientX, y: event.clientY };
    const caret = document.caretRangeFromPoint(point.x, point.y);
    if (domSelectionHit(range, caret, point)) {
      applyDomSelection(selection, range, backward);
    } else if (caret && root.contains(caret.startContainer)) {
      range = caret;
      backward = false;
      selection.collapse(range.startContainer, range.startOffset);
    } else if (range) {
      // Blank or unmappable positions must never keep a stale selected range.
      range.collapse(backward);
      backward = false;
      selection.collapse(range.startContainer, range.startOffset);
    }
  }

  const focus = backward ? range?.startContainer : range?.endContainer;
  const start = keyboard && focus ? focus : event.target;
  const element = start?.nodeType === Node.ELEMENT_NODE ? start : start?.parentElement;
  const block = codeFenceAt(element);
  const code = block?.querySelector(':scope > pre.vditor-ir__marker--pre > code') ?? element?.closest('pre > code');
  const cell = element?.closest('td, th');
  const href = linkAddress(element);
  const anchor = keyboard && range ? range.cloneRange() : null;
  anchor?.collapse(backward);
  return {
    root, range, editable, href, block, cell,
    selection: Boolean(range && !range.collapsed),
    backward,
    codeText: code?.textContent,
    kind: code ? 'code' : cell ? 'table' : href ? 'link' : 'text',
    position: keyboard ? anchorRect(anchor, root) : undefined,
  };
}

export function linkAddress(element) {
  return element?.closest?.('a[href]')?.getAttribute('href') ||
    element?.closest?.('[data-type="a"]')?.querySelector(':scope > .vditor-ir__marker--link')?.textContent.replace(/^\u200b/, '').trim();
}

function applyDomSelection(selection, range, backward) {
  const start = [range.startContainer, range.startOffset];
  const end = [range.endContainer, range.endOffset];
  selection.setBaseAndExtent(...(backward ? [...end, ...start] : [...start, ...end]));
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
    applyDomSelection(selection, range, backward);
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

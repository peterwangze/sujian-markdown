import { safeInlineStyle } from './safe-inline-css.js';
import './live-html-inline.css';

const formattingTags = new Set([
  'b', 'cite', 'code', 'del', 'em', 'i', 'ins', 'kbd', 'mark', 'q', 'rp', 'rt',
  'ruby', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'u', 'var',
]);
const sourceTag = /^<(\/)?([a-z][\da-z-]*)(?=[\s/>])([\s\S]*)>$/i;
const wrapperSelector = 'span[data-sujian-inline-html]';
const previewSelector = '.vditor-ir__preview, [contenteditable="false"]';

function childOffset(node) {
  return Array.prototype.indexOf.call(node.parentNode.childNodes, node);
}

function rememberPoint(node, offset) {
  return { node, offset, before: node.childNodes[offset], after: node.childNodes[offset - 1] };
}

function restorePoint(root, { node, offset, before, after }) {
  if (before && root.contains(before)) return [before.parentNode, childOffset(before)];
  if (after && root.contains(after)) return [after.parentNode, childOffset(after) + 1];
  if (!root.contains(node)) return null;
  const length = node.nodeType === Node.TEXT_NODE ? node.length : node.childNodes.length;
  return [node, Math.min(offset, length)];
}

function inlinePairs(root) {
  const stacks = new Map();
  const pairs = [];
  for (const marker of root.querySelectorAll('.vditor-ir__node[data-type="html-inline"] > code.vditor-ir__marker')) {
    if (marker.closest(previewSelector)) continue;
    const syntax = marker.textContent.trim();
    const match = sourceTag.exec(syntax);
    if (!match) continue;
    const [, closing, rawName, attributes] = match;
    const name = rawName.toLowerCase();
    const boundary = marker.parentElement;
    const hardBreak = name === 'br' && !closing && /^\s*\/?\s*$/.test(attributes);
    if (hardBreak !== boundary.hasAttribute('data-sujian-break')) boundary.toggleAttribute('data-sujian-break', hardBreak);
    if (!formattingTags.has(name) || /\/\s*$/.test(attributes)) continue;

    const parent = boundary.parentElement;
    if (!stacks.has(parent)) stacks.set(parent, []);
    const stack = stacks.get(parent);
    if (!closing) {
      stack.push({ name, syntax, start: boundary });
      continue;
    }
    if (attributes.trim() || stack.at(-1)?.name !== name) {
      // A cross-nested or incomplete tag is kept in the editable source.
      stack.length = 0;
      continue;
    }
    pairs.push({ ...stack.pop(), end: boundary });
  }
  return pairs;
}

function wrapperStyle(document, template, { syntax, name }) {
  if (!/\bstyle\s*=/i.test(syntax)) return '';
  // A template reads the attribute without attaching any author markup.
  template.innerHTML = syntax;
  const source = template.content.firstElementChild;
  return source?.localName === name ? safeInlineStyle(source.getAttribute('style') ?? '', document) : '';
}

export function decorateLiveInlineHtml(root) {
  const document = root.ownerDocument;
  const selection = document.getSelection();
  const selectionInside = root.contains(selection?.anchorNode) && root.contains(selection?.focusNode);
  const anchor = selectionInside ? rememberPoint(selection.anchorNode, selection.anchorOffset) : null;
  const focus = selectionInside ? rememberPoint(selection.focusNode, selection.focusOffset) : null;
  const template = document.createElement('template');
  const used = new Set();
  let moved = false;
  for (const pair of inlinePairs(root)) {
    const { start, end, name } = pair;
    const first = start.nextSibling;
    if (first === end || (name === 'kbd' && first?.tagName === 'KBD' && first.nextSibling === end)) continue;
    const reusable = first?.matches?.(wrapperSelector) && first.nextSibling === end;
    const wrapper = reusable ? first : document.createElement('span');
    if (wrapper.dataset.sujianInlineHtml !== name) wrapper.dataset.sujianInlineHtml = name;
    const style = wrapperStyle(document, template, pair);
    if (style && wrapper.getAttribute('style') !== style) wrapper.setAttribute('style', style);
    if (!style && wrapper.hasAttribute('style')) wrapper.removeAttribute('style');
    if (!reusable) {
      // Lute treats a generic span as transparent in both its Markdown
      // serializer and its live editor parser.
      while (start.nextSibling && start.nextSibling !== end) wrapper.append(start.nextSibling);
      start.after(wrapper);
      moved = true;
    }
    used.add(wrapper);
  }
  for (const wrapper of root.querySelectorAll(wrapperSelector)) {
    if (used.has(wrapper) || wrapper.closest(previewSelector)) continue;
    wrapper.replaceWith(...wrapper.childNodes);
    moved = true;
  }
  if (moved && anchor && focus) {
    const newAnchor = restorePoint(root, anchor);
    const newFocus = restorePoint(root, focus);
    if (newAnchor && newFocus) selection.setBaseAndExtent(...newAnchor, ...newFocus);
  }
}

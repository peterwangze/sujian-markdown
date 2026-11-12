import { offsetAt } from './rich-text-range.js';
import { technicalSpellcheckRanges } from './technical-spellcheck.js';

const excluded = [
  'pre', 'code', 'kbd', 'samp', 'tt', 'var', 'math', '[contenteditable="false"]',
  '[data-type="code-block"]', '[data-type="math-block"]', '[data-type="math-inline"]',
  '[data-type="yaml-front-matter"]', '[data-type="html-block"]', '[data-type="html-inline"]',
  '[data-type="link-ref-defs-block"]',
  '.vditor-ir__marker', '.vditor-ir__preview', '.vditor-copy',
  '[data-sujian-inline-html="code"]', '[data-sujian-inline-html="kbd"]',
  '[data-sujian-inline-html="samp"]', '[data-sujian-inline-html="var"]',
].join(', ');
const addressLabel = 'data-sujian-spellcheck-address';
const tokenAttribute = 'data-sujian-spellcheck-token';
const tokenSelector = `[${tokenAttribute}]`;
const address = /^(?:(?:[a-z][a-z\d+.-]*:\/\/|www\.)\S+|(?:mailto:)?[^\s@]+@[^\s@]+\.[^\s@]+)$/i;

function excludedScope(root, element) {
  const scope = element?.closest(`${excluded}, [spellcheck="false"]`);
  return scope && scope !== root && root.contains(scope);
}

function isToken(node) {
  return node?.nodeType === Node.ELEMENT_NODE && node.hasAttribute(tokenAttribute);
}

function textChunks(text, ranges) {
  const chunks = [];
  let from = 0;
  for (const range of ranges) {
    if (from < range.from) chunks.push({ text: text.slice(from, range.from), token: false });
    chunks.push({ text: text.slice(range.from, range.to), token: true });
    from = range.to;
  }
  if (from < text.length) chunks.push({ text: text.slice(from), token: false });
  return chunks;
}

function textPoint(nodes, offset) {
  for (const node of nodes) {
    const text = isToken(node) ? node.firstChild : node;
    if (offset <= text.length) return { node: text, offset };
    offset -= text.length;
  }
}

function remapPoint(point, parent, oldNodes, newNodes, start) {
  if (point.node === parent) {
    const index = point.offset - start;
    if (index >= oldNodes.length) return { node: parent, offset: point.offset + newNodes.length - oldNodes.length };
    if (index <= 0) return point;
    const offset = oldNodes.slice(0, index).reduce((length, node) => length + node.textContent.length, 0);
    return textPoint(newNodes, offset) ?? { node: parent, offset: start };
  }
  let offset = 0;
  for (const node of oldNodes) {
    if (node.contains(point.node)) {
      return textPoint(newNodes, offset + offsetAt(node, point.node, point.offset)) ?? { node: parent, offset: start };
    }
    offset += node.textContent.length;
  }
  return point;
}

function decorateRun(parent, nodes, points) {
  if (!nodes.length) return points;
  const text = nodes.map((node) => node.textContent).join('');
  const ranges = technicalSpellcheckRanges(text);
  if (!ranges.length && !nodes.some(isToken)) return points;
  const chunks = textChunks(text, ranges);
  if (nodes.length === chunks.length && nodes.every((node, index) =>
    node.textContent === chunks[index].text && isToken(node) === chunks[index].token)) return points;

  const document = parent.ownerDocument;
  const replacements = chunks.map((chunk) => {
    if (!chunk.token) return document.createTextNode(chunk.text);
    const span = document.createElement('span');
    span.setAttribute(tokenAttribute, '');
    span.setAttribute('spellcheck', 'false');
    span.textContent = chunk.text;
    return span;
  });
  const start = Array.prototype.indexOf.call(parent.childNodes, nodes[0]);
  const updated = points?.map((point) => remapPoint(point, parent, nodes, replacements, start));
  // A plain span keeps the visible word editable and is transparent to Vditor's Markdown serialization.
  nodes[0].before(...replacements);
  for (const node of nodes) node.remove();
  return updated;
}

function decorateTechnicalWords(root) {
  const document = root.ownerDocument;
  const selection = document.getSelection();
  const original = root.contains(selection?.anchorNode) && root.contains(selection?.focusNode) ? [
    { node: selection.anchorNode, offset: selection.anchorOffset },
    { node: selection.focusNode, offset: selection.focusOffset },
  ] : undefined;
  let points = original;
  const parents = new Set();
  for (const span of root.querySelectorAll(tokenSelector)) {
    if (span.firstElementChild) {
      // A paste or format command can make a previously plain word contain markup.
      span.removeAttribute(tokenAttribute);
      span.removeAttribute('spellcheck');
    } else if (!excludedScope(root, span.parentElement)) {
      parents.add(span.parentElement);
    }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = isToken(node.parentElement) ? node.parentElement.parentElement : node.parentElement;
    if (parent && !excludedScope(root, parent)) parents.add(parent);
  }
  for (const parent of parents) {
    let run = [];
    for (const node of [...parent.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE || isToken(node)) run.push(node);
      else if (run.length) {
        points = decorateRun(parent, run, points);
        run = [];
      }
    }
    points = decorateRun(parent, run, points);
  }
  if (points?.some((point, index) => point.node !== original[index].node || point.offset !== original[index].offset)) {
    const [anchor, focus] = points;
    selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
  }
}

export function decorateLiveSpellcheck(root) {
  for (const element of root.querySelectorAll(excluded)) {
    if (element.getAttribute('spellcheck') !== 'false') element.setAttribute('spellcheck', 'false');
  }
  for (const label of root.querySelectorAll(`.vditor-ir__link, [${addressLabel}]`)) {
    if (label.classList.contains('vditor-ir__link') && address.test(label.textContent.trim())) {
      if (label.getAttribute('spellcheck') !== 'false') {
        label.setAttribute(addressLabel, '');
        label.setAttribute('spellcheck', 'false');
      }
    } else if (label.hasAttribute(addressLabel)) {
      label.removeAttribute(addressLabel);
      label.removeAttribute('spellcheck');
    }
  }
  if (root.spellcheck) decorateTechnicalWords(root);
}

export function liveSpellcheckExcluded(root, range) {
  const node = range?.startContainer;
  if (!node || !root.contains(node) || root.getAttribute('spellcheck') === 'false') return true;
  const element = node.nodeType === 1 ? node : node.parentElement;
  if (excludedScope(root, element)) return true;
  if (node.nodeType !== 3) return false;
  const offset = Math.min(range.startOffset, node.length - 1);
  return technicalSpellcheckRanges(node.data).some(({ from, to }) => from <= offset && offset < to);
}

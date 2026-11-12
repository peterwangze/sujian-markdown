const marks = {
  bold: { type: 'strong', tag: 'strong', marker: '**' },
  italic: { type: 'em', tag: 'em', marker: '*' },
  strike: { type: 's', tag: 's', marker: '~~' },
  'inline-code': { type: 'code', tag: 'code', marker: '`' },
  highlight: { type: 'mark', tag: 'mark', marker: '==' },
  superscript: { type: 'sup', tag: 'sup', marker: '^' },
  subscript: { type: 'sub', tag: 'sub', marker: '~' },
  underline: { type: 'u', tag: 'span', html: true },
};

const nativeSelector = Object.values(marks).filter(spec => !spec.html)
  .map(spec => `.vditor-ir__node[data-type="${spec.type}"]`).join(', ');
const underlineSelector = '[data-sujian-inline-html="u"]';
const ignoredText = '.vditor-ir__marker, .vditor-ir__preview, [contenteditable="false"], [data-type="code-block"]';

function visibleTextNodes(root) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE && node.length && !node.parentElement?.closest(ignoredText)) nodes.push(node);
  }
  return nodes;
}

function marker(document, text, html = false) {
  const token = document.createElement(html ? 'code' : 'span');
  token.className = 'vditor-ir__marker';
  token.textContent = text;
  if (!html) return token;
  const wrapper = document.createElement('span');
  wrapper.className = 'vditor-ir__node';
  wrapper.dataset.type = 'html-inline';
  wrapper.append(token);
  return wrapper;
}

function nativeShell(body) {
  const wrapper = body?.parentElement;
  if (!wrapper?.matches(nativeSelector) || wrapper.children[1] !== body) return null;
  return wrapper;
}

function underlineMarkers(body) {
  const before = body.previousSibling;
  const after = body.nextSibling;
  return body.matches(underlineSelector) && before?.nodeType === Node.ELEMENT_NODE && after?.nodeType === Node.ELEMENT_NODE &&
    before.dataset.type === 'html-inline' && after.dataset.type === 'html-inline' &&
    /^<u(?:\s[^>]*)?>$/i.test(before.textContent) && /^<\/u>$/i.test(after.textContent) ? [before, after] : null;
}

function hasContents(element) {
  return element.textContent !== '' || Boolean(element.firstElementChild);
}

function codeMarkers(value) {
  let length = 1;
  for (const [ticks] of value.matchAll(/`+/g)) length = Math.max(length, ticks.length + 1);
  const fence = '`'.repeat(length);
  return value.startsWith('`') || value.endsWith('`') ? [fence + ' ', ' ' + fence] : [fence, fence];
}

function trimNativeEdges(wrapper) {
  if (!wrapper) return;
  const body = wrapper.children[1];
  if (wrapper.dataset.type === 'code') {
    const [opening, closing] = codeMarkers(body.textContent);
    wrapper.firstElementChild.textContent = opening;
    wrapper.lastElementChild.textContent = closing;
    return;
  }
  const nodes = visibleTextNodes(body);
  const leading = nodes[0];
  const trailing = nodes.at(-1);
  if (!nodes.some(node => node.data.trim())) {
    wrapper.replaceWith(...body.childNodes);
    return;
  }
  const head = leading.data.length - leading.data.trimStart().length;
  const tail = trailing.data.trimEnd().length;
  // Move delimiter-edge whitespace outside its style without changing text order.
  if (tail < trailing.length) wrapper.after(trailing.splitText(tail));
  if (head) {
    leading.splitText(head);
    wrapper.before(leading);
  }
}

function liftBoundary(node, offset, scope) {
  if (!scope.contains(node) || offset > node.length) return null;
  const boundary = node.ownerDocument.createComment('');
  const escaped = node.parentElement.closest('.vditor-ir__node[data-type="backslash"]');
  if (escaped && scope.contains(escaped) && (offset === 0 || offset === node.length)) {
    if (offset === 0) escaped.before(boundary);
    else escaped.after(boundary);
  } else if (offset === 0) node.before(boundary);
  else {
    if (offset < node.length) node.splitText(offset);
    node.after(boundary);
  }
  while (boundary.parentNode !== scope) {
    const left = boundary.parentElement;
    const right = left.cloneNode(false);
    while (boundary.nextSibling) right.append(boundary.nextSibling);
    const native = nativeShell(left);
    const underline = underlineMarkers(left);
    if (native) {
      const shell = native.cloneNode(false);
      shell.append(native.firstElementChild.cloneNode(true), right, native.lastElementChild.cloneNode(true));
      native.after(boundary);
      if (hasContents(right)) boundary.after(shell);
      if (!hasContents(left)) native.remove();
      trimNativeEdges(native.isConnected ? native : null);
      trimNativeEdges(shell.isConnected ? shell : null);
    } else if (underline) {
      const [before, after] = underline;
      after.after(boundary);
      if (hasContents(right)) boundary.after(before.cloneNode(true), right, after.cloneNode(true));
      if (!hasContents(left)) { before.remove(); left.remove(); after.remove(); }
    } else {
      left.after(boundary);
      if (hasContents(right)) boundary.after(right);
      if (!hasContents(left)) left.remove();
    }
  }
  return boundary;
}

function selectedSegments(range, spec) {
  const segments = [];
  for (const node of visibleTextNodes(range.commonAncestorContainer)) {
    if (!range.intersectsNode(node)) continue;
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.length;
    if (from >= to) continue;
    const block = node.parentElement?.closest('p, li, h1, h2, h3, h4, h5, h6, td, th');
    if (!block) continue;
    const label = node.parentElement.closest('.vditor-ir__link');
    const link = label?.parentElement;
    const scope = link && (spec.type === 'code' || link.contains(range.startContainer) || link.contains(range.endContainer)) ? label : block;
    if (segments.at(-1)?.scope !== scope) segments.push({ scope, parts: [] });
    segments.at(-1).parts.push({ node, from, to, text: node.data.slice(from, to) });
  }
  return segments.filter(({ parts }) => parts.some(part => part.text.trim()));
}

function unwrapFormat(fragment, selector, spec) {
  for (const element of Array.from(fragment.querySelectorAll(selector)).reverse()) {
    if (spec.html) {
      const pair = underlineMarkers(element);
      if (!pair) continue;
      pair.forEach(token => token.remove());
      element.replaceWith(...element.childNodes);
    } else {
      const body = element.children[1];
      if (nativeShell(body) === element) element.replaceWith(...body.childNodes);
    }
  }
}

function escapeDelimiter(fragment, delimiter) {
  for (const node of visibleTextNodes(fragment)) {
    if (!node.data.includes(delimiter) || node.parentElement?.closest('code, [data-type="backslash"]')) continue;
    const document = node.ownerDocument;
    const parts = node.data.split(delimiter);
    const replacement = document.createDocumentFragment();
    replacement.append(parts[0]);
    for (const part of parts.slice(1)) {
      const wrapper = document.createElement('span');
      wrapper.className = 'vditor-ir__node';
      wrapper.dataset.type = 'backslash';
      const token = marker(document, '\\');
      token.classList.add('vditor-ir__marker--bi');
      wrapper.append(token, delimiter);
      replacement.append(wrapper, part);
    }
    node.replaceWith(replacement);
  }
}

function wrapFormat(document, fragment, spec) {
  const body = document.createElement(spec.tag);
  if (spec.html) {
    body.dataset.sujianInlineHtml = 'u';
    body.append(fragment);
    return { body, nodes: [marker(document, '<u>', true), body, marker(document, '</u>', true)] };
  }
  let opening = spec.marker;
  let closing = spec.marker;
  if (spec.type === 'code') {
    const value = visibleTextNodes(fragment).map(node => node.data).join('');
    [opening, closing] = codeMarkers(value);
    body.textContent = value;
  } else {
    escapeDelimiter(fragment, spec.marker[0]);
    body.append(fragment);
  }
  body.dataset.newline = '1';
  const wrapper = document.createElement('span');
  wrapper.className = 'vditor-ir__node';
  wrapper.dataset.type = spec.type;
  const start = marker(document, opening);
  const end = marker(document, closing);
  if (spec.type === 'strong' || spec.type === 'em') {
    start.classList.add('vditor-ir__marker--bi');
    end.classList.add('vditor-ir__marker--bi');
  }
  wrapper.append(start, body, end);
  return { body, nodes: [wrapper] };
}

function adjacent(node, property) {
  let sibling = node[property];
  while (sibling?.nodeType === Node.TEXT_NODE && !sibling.length) sibling = sibling[property];
  return sibling?.nodeType === Node.ELEMENT_NODE ? sibling : null;
}

function applySegment({ scope, parts }, selector, spec, remove) {
  const first = parts.find(part => part.text.trim());
  const last = parts.findLast(part => part.text.trim());
  const end = liftBoundary(last.node, last.to - last.text.length + last.text.trimEnd().length, scope);
  if (!end) return [];
  const start = liftBoundary(first.node, first.from + first.text.length - first.text.trimStart().length, scope);
  if (!start) { end.remove(); return []; }
  const nodes = [];
  let sibling = start.nextSibling;
  while (sibling && sibling !== end) {
    nodes.push(sibling);
    sibling = sibling.nextSibling;
  }
  if (sibling !== end) { start.remove(); end.remove(); return []; }
  const document = scope.ownerDocument;
  const fragment = document.createDocumentFragment();
  fragment.append(...nodes);
  if (spec.type === 'code' && fragment.querySelector('img, input, [data-type="code-block"]')) {
    const text = visibleTextNodes(fragment);
    start.after(fragment);
    start.remove();
    end.remove();
    return [text[0], text.at(-1)];
  }
  unwrapFormat(fragment, selector, spec);

  const format = remove ? null : wrapFormat(document, fragment, spec);
  const text = visibleTextNodes(format?.body ?? fragment);
  if (format) {
    start.after(...format.nodes);
    if (!spec.html && spec.type !== 'code') {
      const previous = adjacent(start, 'previousSibling');
      const next = adjacent(end, 'nextSibling');
      const wrapper = format.nodes[0];
      let body = format.body;
      if (previous?.matches(selector) && nativeShell(previous.children[1]) === previous && previous.firstElementChild.textContent === spec.marker) {
        body = previous.children[1];
        body.append(...format.body.childNodes);
        wrapper.remove();
      }
      if (next?.matches(selector) && nativeShell(next.children[1]) === next && next.firstElementChild.textContent === spec.marker) {
        body.append(...next.children[1].childNodes);
        next.remove();
      }
    }
  } else start.after(fragment);
  start.remove();
  end.remove();
  return [text[0], text.at(-1)];
}

export function formatLiveSelection(editable, engine, command) {
  const spec = marks[command];
  if (!spec) return false;
  const selection = editable.ownerDocument.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!editable.contains(range.startContainer) || !editable.contains(range.endContainer)) return false;
  const segments = selectedSegments(range, spec);
  if (!segments.length) return true;
  const selector = spec.html ? underlineSelector : `.vditor-ir__node[data-type="${spec.type}"]`;
  const remove = segments.every(({ parts }) => parts.every(({ node, text }) => !text.trim() || node.parentElement.closest(selector)));
  const backward = selection.anchorNode !== range.startContainer || selection.anchorOffset !== range.startOffset;
  const boundaries = segments.reverse().map(segment => applySegment(segment, selector, spec, remove)).filter(([first, last]) => first && last);
  const start = boundaries.at(-1)?.[0];
  const end = boundaries[0]?.[1];
  if (start && end) {
    const first = [start, 0];
    const last = [end, end.length];
    selection.setBaseAndExtent(...(backward ? [...last, ...first] : [...first, ...last]));
  }
  engine.ir.preventInput = true;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  return true;
}

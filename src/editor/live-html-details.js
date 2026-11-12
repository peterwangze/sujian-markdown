import './live-html-details.css';

const htmlBlock = '[data-block="0"][data-type="html-block"]';
const sourceMarker = ':scope > .vditor-ir__marker--pre > code[data-type="html-block"]';
const previewMarker = ':scope > .vditor-ir__preview';
const foldedAttribute = 'data-sujian-details-folded';
const closingAttribute = 'data-sujian-details-closing';
const separateSummaryAttribute = 'data-sujian-details-summary';
const emptyOpenerAttribute = 'data-sujian-details-empty-opener';
const htmlToken = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-z][\w:-]*)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
const rawTextTags = new Set(['iframe', 'noembed', 'noframes', 'plaintext', 'script', 'style', 'template', 'textarea', 'title', 'xmp']);
const trailingWhitespaceOrComments = /^(?:\s|<!--[\s\S]*?-->)*$/;

function* detailsTokens(source) {
  let rawTextTag;
  let templateDepth = 0;
  for (const match of source.matchAll(htmlToken)) {
    const [token, closing, tag] = match;
    const name = tag?.toLowerCase();
    if (rawTextTag) {
      if (rawTextTag === 'template' && name === rawTextTag) {
        templateDepth += closing ? -1 : 1;
        if (!templateDepth) rawTextTag = undefined;
      } else if (closing && name === rawTextTag && name !== 'plaintext') rawTextTag = undefined;
      continue;
    }
    if (!closing && rawTextTags.has(name)) {
      rawTextTag = name;
      if (name === 'template') templateDepth = 1;
    } else if (name === 'details') {
      yield { closing: Boolean(closing), start: match.index, end: match.index + token.length };
    }
  }
}

function leadingPreviewElements(preview, source) {
  if (!preview?.firstElementChild) return [];
  const template = preview.ownerDocument.createElement('template');
  template.innerHTML = source;
  const prefix = [...template.content.childNodes].filter((node) =>
    node.nodeType !== Node.COMMENT_NODE && (node.nodeType !== Node.TEXT_NODE || node.textContent.trim()));
  const rendered = [...preview.children].slice(0, prefix.length);
  // Only hide existing elements when the parsed prefix aligns with Vditor's
  // sanitized preview. HTML after the closing token stays in the document.
  return prefix.every((node, index) => node.nodeType === Node.ELEMENT_NODE &&
    node.localName === rendered[index]?.localName && node.textContent === rendered[index].textContent) ? rendered : [];
}

function mixedDetails(root) {
  const groups = [];
  const stacks = new Map();
  const occurrences = new Map();
  for (const block of root.querySelectorAll(htmlBlock)) {
    if (block.closest('.vditor-ir__preview')) continue;
    const source = block.querySelector(sourceMarker)?.textContent;
    if (!source) continue;
    const preview = block.querySelector(previewMarker);
    const parent = block.parentElement;
    const separateSummary = /^\s*<summary[\s/>]/i.test(source) && preview?.querySelector(':scope > summary');
    const enclosing = stacks.get(parent)?.at(-1);
    if (separateSummary && enclosing && !enclosing.summary) {
      enclosing.summary = separateSummary;
      enclosing.summaryBlock = block;
    }
    if (!/<\/?details[\s/>]/i.test(source)) continue;
    const details = preview?.querySelectorAll('details') ?? [];
    if (!stacks.has(parent)) stacks.set(parent, []);
    const stack = stacks.get(parent);
    let detailIndex = 0;
    for (const { closing, start, end } of detailsTokens(source)) {
      if (!closing) {
        const detail = details[detailIndex];
        const identity = `${detailIndex}\u0000${source}`;
        const occurrence = occurrences.get(identity) ?? 0;
        occurrences.set(identity, occurrence + 1);
        stack.push({ start: block, detail, summary: detail?.querySelector(':scope > summary'), key: `${occurrence}\u0000${identity}` });
        detailIndex += 1;
        continue;
      }
      const opening = stack.pop();
      if (!opening?.detail || opening.start === block) continue;
      const members = [];
      if (opening.summaryBlock && opening.summaryBlock !== block) {
        for (let sibling = opening.summary.nextElementSibling; sibling; sibling = sibling.nextElementSibling) members.push(sibling);
      }
      for (let sibling = opening.start.nextElementSibling; sibling && sibling !== block; sibling = sibling.nextElementSibling) {
        if (sibling !== opening.summaryBlock) members.push(sibling);
      }
      if (block !== opening.summaryBlock && (preview?.children.length || preview?.textContent.trim()) &&
        trailingWhitespaceOrComments.test(source.slice(end))) {
        members.push(block);
      } else {
        members.push(...leadingPreviewElements(preview, source.slice(0, start)).filter((element) => element !== opening.summary));
      }
      if (members.length || opening.summaryBlock) groups.push({ ...opening, end: block, members });
    }
  }
  return groups;
}

function containsBody(group, node) {
  return node && (group.members.some((member) => member.contains(node)) ||
    (node !== group.detail && group.detail.contains(node) && !group.summary?.contains(node)));
}

function markElements(root, attribute, elements) {
  // Undo can restore cloned blocks that carry old presentation attributes.
  for (const element of root.querySelectorAll(`[${attribute}]`)) {
    if (!elements.has(element)) element.removeAttribute(attribute);
  }
  for (const element of elements) element.setAttribute(attribute, '');
}

export function createLiveHtmlDetails(root) {
  const doc = root.ownerDocument;
  const documents = new Map();
  let documentId;
  let states;
  let groups = new Map();
  let separateSummaries = new Map();

  function restoreSummary(summary, attributes) {
    summary.removeAttribute(separateSummaryAttribute);
    for (const [name, value] of attributes) {
      if (value === null) summary.removeAttribute(name);
      else summary.setAttribute(name, value);
    }
  }

  function applyVisibility() {
    const next = new Set();
    for (const group of groups.values()) {
      if (!group.detail.open) group.members.forEach((member) => next.add(member));
      if (group.summaryBlock) group.summary.setAttribute('aria-expanded', String(group.detail.open));
    }
    markElements(root, foldedAttribute, next);
  }

  function setOpen(group, open) {
    group.detail.open = open;
    if (group.key !== undefined) states.set(group.key, open);
  }

  function moveCaretOut(group) {
    const selection = doc.getSelection();
    if (!selection || (!containsBody(group, selection.anchorNode) && !containsBody(group, selection.focusNode))) return;
    if (group.summary) {
      group.summary.focus({ preventScroll: true });
      selection.collapse(group.summary, 0);
    } else {
      const range = doc.createRange();
      range.setStartBefore(group.start);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  function reveal(target) {
    let changed = false;
    for (const group of groups.values()) {
      if (!group.detail.open && containsBody(group, target)) {
        setOpen(group, true);
        changed = true;
      }
    }
    if (changed) applyVisibility();
  }

  function refresh(nextDocumentId) {
    const sameDocument = nextDocumentId === documentId;
    documentId = nextDocumentId;
    if (!documents.has(documentId)) documents.set(documentId, new Map());
    states = documents.get(documentId);
    const current = mixedDetails(root);
    const previous = groups;
    groups = new Map(current.map((group) => [group.detail, group]));
    markElements(root, closingAttribute, new Set(current.map((group) => group.end)));
    const nextSummaries = new Map();
    const nextOpeners = new Set();
    for (const group of current) {
      if ((!sameDocument || !previous.has(group.detail)) && states.has(group.key)) {
        group.detail.open = states.get(group.key);
      }
      if (group.summaryBlock) {
        const summary = group.summary;
        const attributes = separateSummaries.get(summary) ?? ['role', 'tabindex', 'aria-expanded']
          .map((name) => [name, summary.getAttribute(name)]);
        nextSummaries.set(summary, attributes);
        summary.setAttribute(separateSummaryAttribute, '');
        summary.setAttribute('role', 'button');
        summary.tabIndex = 0;
        if (!group.detail.children.length && !group.detail.textContent.trim()) nextOpeners.add(group.start);
      }
    }
    for (const [summary, attributes] of separateSummaries) {
      if (!nextSummaries.has(summary)) restoreSummary(summary, attributes);
    }
    separateSummaries = nextSummaries;
    markElements(root, emptyOpenerAttribute, nextOpeners);
    const selection = doc.getSelection();
    if (sameDocument && root.contains(doc.activeElement)) {
      reveal(selection?.anchorNode);
      reveal(selection?.focusNode);
    }
    applyVisibility();
  }

  function toggle(event) {
    const group = groups.get(event.target);
    if (!group) return;
    if (!group.detail.open) moveCaretOut(group);
    states.set(group.key, group.detail.open);
    applyVisibility();
  }

  function control(target) {
    const summary = target.closest?.('summary');
    if (target !== summary && target.closest?.('a, button, input, select, textarea')) return;
    const detail = summary?.parentElement ?? target;
    const mixed = groups.get(detail) ?? (separateSummaries.has(summary) &&
      [...groups.values()].find((group) => group.summary === summary));
    if (mixed && mixed.summary === summary) return mixed;
    if (summary && detail.localName === 'details' && detail.querySelector(':scope > summary') === summary &&
      detail.closest(`${htmlBlock} > .vditor-ir__preview`)) return { detail, summary, members: [] };
  }

  function activate(group) {
    const open = !group.detail.open;
    if (!open) moveCaretOut(group);
    setOpen(group, open);
    applyVisibility();
  }

  function pointer(event) {
    const group = control(event.target);
    if (!group || event.button !== 0 || event.defaultPrevented) return;
    // Vditor normally routes a preview click into its raw HTML source editor.
    // A normal summary click uses the browser's disclosure behavior instead.
    if (event.altKey) {
      event.preventDefault();
      return;
    }
    event.stopImmediatePropagation();
    if (group.summaryBlock) {
      event.preventDefault();
      activate(group);
    }
  }

  function keydown(event) {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey ||
      (event.key !== 'Enter' && event.key !== ' ')) return;
    const group = control(event.target);
    if (!group) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) activate(group);
  }

  root.addEventListener('toggle', toggle, true);
  root.addEventListener('click', pointer, true);
  root.addEventListener('keydown', keydown, true);
  return {
    refresh,
    reveal,
    dispose() {
      root.removeEventListener('toggle', toggle, true);
      root.removeEventListener('click', pointer, true);
      root.removeEventListener('keydown', keydown, true);
      for (const attribute of [foldedAttribute, closingAttribute, emptyOpenerAttribute]) markElements(root, attribute, new Set());
      for (const [summary, attributes] of separateSummaries) restoreSummary(summary, attributes);
    },
  };
}

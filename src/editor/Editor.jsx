import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Annotation, Compartment, EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView, drawSelection, dropCursor, highlightActiveLine, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { tags } from '@lezer/highlight';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { resolveTheme } from '../theme/themes.js';
import { isComposingKey } from '../workspace/commands.js';
import { desktop } from '../workspace/desktop.js';
import { changeFenceLanguage, CodeLanguageControl, codeFenceAt, codeFenceLanguage, codeFenceSource, focusCodeFence, liveFenceHistorySources, normalizeLiveFencePreviews } from './CodeLanguageControl.jsx';
import { contextSelection, domContext, linkAddress, restoreEditorContext, sourceContext, sourceSpellingAt, spellingAt } from './editor-context.js';
import { completeFenceHeaders, replaceFenceLanguage, structuredFenceSources } from './fence-info.js';
import { formatMarkdown } from './format.js';
import { createLiveHtmlDetails } from './live-html-details.js';
import { decorateLiveInlineHtml } from './live-html-inline.js';
import { decorateLiveSpellcheck } from './live-spellcheck.js';
import { formatLiveSelection } from './live-inline-format.js';
import { openEnclosingDetails, scrollToMarkdownAnchor } from './markdown-anchors.js';
import { matchMarkdown, projectMarkdownEdit, replacementText } from './markdown-edits.js';
import { handleRichCodeKeys } from './rich-code-keys.js';
import { handleRichListKeys, handleRichListTrigger } from './rich-list-keys.js';
import { handleRichHardBreak, handleRichParagraphKeys } from './rich-paragraph-keys.js';
import { formatSourceInlineSelection, removeSourceInlineFormat, setSourceHeading } from './source-format.js';
import { indentSource, sourceKeys } from './source-keys.js';
import { sourceSpellcheckExclusions } from './source-spellcheck.js';
import { highlightCode, isLocalImage, loadVendorScript, markdownOptions, renderLegacyDiagram, renderLiveGithubMath, renderPreview, vendorRoot } from './render-document.js';
import './editor.css';
import './content-layout.css';
import { observeWideTables } from './wide-tables.js';

const nativeCommands = ['bold', 'italic', 'strike', 'inline-code', 'quote', 'list', 'ordered-list', 'check', 'indent', 'outdent', 'undo', 'redo'];
const lineCommands = ['quote', 'list', 'ordered-list', 'check'];
const managedLiveTools = ['headings', ...nativeCommands.filter(name => name !== 'undo' && name !== 'redo'), 'link', 'code', 'line', 'table'];
const sourceText = (value) => value.replace(/\r\n?/g, '\n');
const externalEdit = Annotation.define();
const sourceSyntax = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--accent-ink)', fontWeight: 'bold' },
  { tag: [tags.link, tags.url], color: 'var(--syntax-link)', textDecoration: 'underline' },
  { tag: tags.monospace, color: 'var(--syntax-code)' },
  { tag: tags.quote, color: 'var(--syntax-quote)' },
  { tag: tags.processingInstruction, color: 'var(--muted)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
]);
const sourceAppearance = EditorView.theme({
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, & .cm-selectionBackground': {
    backgroundColor: 'var(--selection, var(--selected))',
  },
  '& .cm-cursor, & .cm-dropCursor': { borderLeftColor: 'var(--accent-ink)' },
});
const tableActions = [
  ['rowAbove', '上方加行', 'f', true], ['rowBelow', '下方加行', '='],
  ['columnLeft', '左侧加列', 'g', true], ['columnRight', '右侧加列', '=', true],
  ['deleteRow', '删行', '-'], ['deleteColumn', '删列', '-', true],
  ['alignLeft', '左对齐', 'l', true], ['alignCenter', '居中', 'c', true], ['alignRight', '右对齐', 'r', true],
];
const tableContextActions = {
  'table-row-above': tableActions[0], 'table-row-below': tableActions[1],
  'table-column-left': tableActions[2], 'table-column-right': tableActions[3],
  'table-delete-row': tableActions[4], 'table-delete-column': tableActions[5],
};
const pasteActions = { paste: 'paste', 'paste-plain': 'pasteAndMatchStyle' };

function sourceSpellcheckSetting(enabled) {
  return [EditorView.contentAttributes.of({ spellcheck: String(enabled) }), enabled ? sourceSpellcheckExclusions : []];
}

function sourceExtensions(onUpdate, latest, wrapping, spellcheck) {
  return [
    markdown({ addKeymap: false }), sourceKeys, syntaxHighlighting(sourceSyntax), sourceAppearance,
    history(), drawSelection(), dropCursor(), highlightActiveLine(),
    wrapping.of(latest.current.wrap ? EditorView.lineWrapping : []),
    spellcheck.of(sourceSpellcheckSetting(latest.current.spellcheck)),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.contentAttributes.of({
      'aria-label': 'Markdown 源码', 'aria-description': '先按 Escape，再按 Tab 或 Shift+Tab 可移出编辑区。',
    }),
    EditorView.scrollMargins.of((view) => {
      if (!latest.current.typewriter) return null;
      const margin = Math.round(view.scrollDOM.clientHeight * 0.35);
      return { top: margin, bottom: margin };
    }),
    EditorView.updateListener.of(onUpdate),
  ];
}

function setLiveTheme(editor, theme) {
  const dark = resolveTheme(theme).scheme === 'dark';
  editor.setTheme(dark ? 'dark' : 'classic', dark ? 'dark' : 'light', dark ? 'github-dark' : 'github');
}

function bindCodeCopy(_code, menu) {
  const trigger = menu.querySelector('span[onclick]');
  const source = menu.querySelector('textarea');
  if (!trigger || !source) return;
  trigger.removeAttribute('onclick');
  trigger.removeAttribute('onmouseover');
  trigger.setAttribute('role', 'button');
  trigger.tabIndex = -1;
  async function copy(event) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await desktop.writeClipboard({ text: source.value });
      trigger.setAttribute('aria-label', '已复制');
    } catch {
      trigger.setAttribute('aria-label', '复制失败');
    }
  }
  trigger.addEventListener('click', copy);
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') void copy(event);
  });
  trigger.addEventListener('pointerenter', () => trigger.setAttribute('aria-label', '复制'));
}

function liveSelectionMarkdown(instance, range) {
  const container = document.createElement('div');
  let contents = range.cloneContents();
  const start = range.commonAncestorContainer;
  const editable = instance.vditor.ir.element;
  for (let element = start.nodeType === Node.ELEMENT_NODE ? start : start.parentElement;
    element && element !== editable; element = element.parentElement) {
    const wrapper = element.parentElement;
    if (!element.matches('strong, em, s, code') || !wrapper?.matches('.vditor-ir__node')) continue;
    const [opening, closing] = [wrapper.firstElementChild, wrapper.lastElementChild];
    if (!opening?.matches('.vditor-ir__marker') || !closing?.matches('.vditor-ir__marker') || opening === closing) continue;
    const clone = wrapper.cloneNode(false);
    const body = element.cloneNode(false);
    body.append(contents);
    clone.append(opening.cloneNode(true), body, closing.cloneNode(true));
    contents = clone;
  }
  container.append(contents);
  return instance.vditor.lute.VditorIRDOM2Md(container.innerHTML).trimEnd() || range.toString();
}

function visibleText(editor) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const ranges = [];
  let text = '';
  let lastBlock;
  let node;

  while ((node = walker.nextNode())) {
    const element = node.parentElement;
    if (element.closest('.vditor-ir__marker, .vditor-ir__preview, .vditor-copy, [contenteditable="false"], style, svg, .katex-mathml')) continue;
    const block = element.closest('p, h1, h2, h3, h4, h5, h6, li, td, th, pre');
    if (lastBlock && block !== lastBlock) text += '\n';
    lastBlock = block;
    ranges.push({ node, from: text.length, to: text.length + node.length });
    text += node.data;
  }

  return { text, ranges };
}

function selectRich(editor, ranges, from, to, reveal) {
  const start = ranges.find((range) => range.from <= from && range.to > from);
  const end = ranges.find((range) => range.from < to && range.to >= to) ?? start;
  if (!start || !end) return false;

  openEnclosingDetails(start.node.parentElement, reveal);
  if (end !== start) openEnclosingDetails(end.node.parentElement, reveal);
  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(start.node, from - start.from);
  range.setEnd(end.node, Math.min(to - end.from, end.node.length));
  editor.focus({ preventScroll: true });
  selection.removeAllRanges();
  selection.addRange(range);
  start.node.parentElement.scrollIntoView({ block: 'nearest' });
  return true;
}

function sourceSelection(view, from, to = from) {
  view.dispatch({ selection: EditorSelection.single(from, to), scrollIntoView: true });
  view.focus();
}

function nextMatch(matches, offset, backward) {
  if (backward) return matches.findLast((match) => match.index < offset) ?? matches.at(-1);
  return matches.find((match) => match.index >= offset) ?? matches[0];
}

function markdownHeading(line) {
  return line.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/)?.[1];
}

function caretPoint(root, node, offset) {
  const path = [];
  for (let current = node; current !== root; current = current.parentNode) {
    if (!current?.parentNode) return null;
    path.unshift(Array.prototype.indexOf.call(current.parentNode.childNodes, current));
  }
  return { path, offset };
}

function restoreCaret(root, caret) {
  if (!caret?.anchor || !caret.focus) return;
  const resolve = (point) => point.path.reduce((node, index) => node?.childNodes[index], root);
  const anchor = resolve(caret.anchor);
  const focus = resolve(caret.focus);
  if (!anchor || !focus) return;
  const offset = (node, point) => Math.min(point.offset, node.nodeType === Node.TEXT_NODE ? node.length : node.childNodes.length);
  window.getSelection()?.setBaseAndExtent(anchor, offset(anchor, caret.anchor), focus, offset(focus, caret.focus));
}

function ensureLinkCaret(root, remembered) {
  const selection = window.getSelection();
  if (!selection) return false;
  const usable = (node) => {
    if (!node || node === root || !root.contains(node)) return false;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !element?.closest('.vditor-ir__marker, .vditor-ir__preview, [contenteditable="false"]');
  };
  if (usable(selection.anchorNode) && usable(selection.focusNode)) return true;
  restoreCaret(root, remembered);
  if (usable(selection.anchorNode) && usable(selection.focusNode)) return true;

  let paragraph = [...root.children].findLast((child) => child.matches('p[data-block="0"]'));
  if (!paragraph) {
    paragraph = document.createElement('p');
    paragraph.dataset.block = '0';
    root.append(paragraph);
  }
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export function Editor({
  docId, value = '', mode = 'live', onChange, onSelection, onLink, onImage, resolveImage, embedImage,
  assetUrl, focusMode = false, typewriter = false, spellcheck = false, wrap = true, allowRemoteMedia = true, theme = 'light', editorRef,
  onContextMenu,
}) {
  const richHost = useRef(null);
  const liveDetails = useRef(null);
  const sourceHost = useRef(null);
  const previewHost = useRef(null);
  const rich = useRef(null);
  const pendingLiveFocus = useRef(null);
  const source = useRef(null);
  const wrapping = useRef(new Compartment());
  const sourceSpelling = useRef(new Compartment());
  const latest = useRef(null);
  const content = useRef({ id: docId, raw: value, rich: null });
  const imageCache = useRef(new Map());
  const tabMemory = useRef(new Map());
  const liveCaret = useRef(null);
  const lastFind = useRef(null);
  const activeBlock = useRef(null);
  const activeCell = useRef(null);
  const editorContext = useRef(null);
  const contextPointer = useRef(null);
  const fenceSources = useRef({ raw: null, blocks: [] });
  const [tableSelection, setTableSelection] = useState(null);
  const [activeFence, setActiveFence] = useState(null);
  const [hoveredFence, setHoveredFence] = useState(null);
  const [languageRequest, setLanguageRequest] = useState(null);
  const [richMounted, setRichMounted] = useState(mode === 'live');
  const [richError, setRichError] = useState('');
  const [previewError, setPreviewError] = useState('');

  latest.current = { mode, onChange, onSelection, onLink, onImage, resolveImage, assetUrl, spellcheck, theme, typewriter, wrap };

  function publish(next) {
    if (next === content.current.raw) return;
    content.current.raw = next;
    latest.current.onChange?.(next);
  }

  function commitRich() {
    const instance = rich.current;
    const before = content.current.rich;
    if (!instance || before === null || latest.current.mode !== 'live' || instance.vditor.ir.composingLock) return;
    const next = instance.getValue();
    const sources = currentFenceSources();
    const baseline = completeFenceHeaders(before, sources);
    const after = completeFenceHeaders(next, liveFenceHistorySources(instance.vditor.ir.element, sources));
    if (next === before && after === baseline) return;
    content.current.rich = next;
    publish(projectMarkdownEdit(content.current.raw, baseline, after));
  }

  function syncRich(clearHistory = true) {
    if (!rich.current) return;
    rich.current.setValue(content.current.raw, clearHistory);
    content.current.rich = rich.current.getValue();
    liveFenceHistorySources(rich.current.vditor.ir.element, currentFenceSources());
  }

  function currentFenceSources() {
    const { raw } = content.current;
    if (fenceSources.current.raw !== raw) fenceSources.current = { raw, blocks: structuredFenceSources(raw) };
    return fenceSources.current.blocks;
  }

  function editorFenceSource(block) {
    const editable = rich.current?.vditor.ir.element;
    return editable ? codeFenceSource(editable, block, currentFenceSources()) : null;
  }

  function applyCodeFenceLanguage(block, language) {
    const editable = rich.current?.vditor.ir.element;
    if (!editable?.contains(block)) return false;
    commitRich();
    const source = editorFenceSource(block);
    if (!source) {
      if (!changeFenceLanguage(editable, block, language)) return false;
      commitRich();
      return true;
    }

    const next = replaceFenceLanguage(source.value, language);
    if (next === null) return false;
    if (next === source.value) {
      focusCodeFence(editable, block);
      return true;
    }
    const { raw } = content.current;
    const scrollTop = editable.scrollTop;
    const engine = rich.current.vditor;
    engine.undo.addToUndoStack(engine);
    publish(raw.slice(0, source.from) + next + raw.slice(source.to));
    syncRich(false);
    editable.scrollTop = scrollTop;
    focusCodeFence(editable, editable.querySelectorAll('[data-type="code-block"]')[source.index]);
    engine.undo.addToUndoStack(engine);
    return true;
  }

  function sourceUpdate(update) {
    if (latest.current.mode === 'live') return;
    if (update.docChanged && update.transactions.some((transaction) => !transaction.annotation(externalEdit))) {
      publish(projectMarkdownEdit(content.current.raw, update.startState.doc.toString(), update.state.doc.toString()));
    }
    if (update.selectionSet) {
      const { from, to } = update.state.selection.main;
      latest.current.onSelection?.(update.state.sliceDoc(from, to));
    }
  }

  function resolveLiveAssets() {
    const load = latest.current.resolveImage ?? (typeof latest.current.assetUrl === 'function' ? latest.current.assetUrl : null);
    if (!load || !rich.current) return;
    const images = rich.current.vditor.ir.element.querySelectorAll('img[src]');
    for (const image of images) {
      const address = image.getAttribute('src');
      if (!isLocalImage(address) || image.dataset.sujianSource === address) continue;
      image.dataset.sujianSource = address;
      if (!imageCache.current.has(address)) {
        imageCache.current.set(address, Promise.resolve().then(() => load(address)).catch(() => undefined));
      }
      const pending = imageCache.current.get(address);
      void pending.then((url) => {
        if (imageCache.current.get(address) === pending && typeof url === 'string' && image.getAttribute('src') === address && /^(?:sujian-asset:\/\/local\/|data:image\/|blob:|https?:)/i.test(url)) {
          // Lute reads src. srcset supplies the resolved display resource while keeping Markdown portable.
          image.srcset = `${url} 1x`;
        }
      });
    }
  }

  function selectCell(cell) {
    activeCell.current = cell;
    const status = cell ? `${cell.tagName === 'TH' ? 'header' : 'body'}-${cell.parentElement.cells.length}` : null;
    setTableSelection(status);
  }

  function tableCommand([action, , baseKey, shiftKey = false], fromCell = activeCell.current) {
    const instance = rich.current;
    let cell = fromCell;
    if (!instance || !cell?.isConnected) return;
    let key = baseKey;
    let shift = shiftKey;
    // When the header already has a body, inserting above its first row keeps a single tbody.
    if (action === 'rowBelow' && cell.tagName === 'TH') {
      const firstRow = cell.closest('table').tBodies[0]?.rows[0];
      if (firstRow) {
        cell = firstRow.cells[cell.cellIndex];
        key = 'f';
        shift = true;
      }
    }

    const selection = window.getSelection();
    const range = document.createRange();
    const oldRange = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    if (!cell.firstChild) cell.append(document.createTextNode(''));
    range.setStart(cell.firstChild, 0);
    range.collapse(true);
    instance.focus();
    selection.removeAllRanges();
    selection.addRange(range);

    const mac = /Mac/i.test(navigator.platform);
    if (!mac && shift) key = key === '=' ? '+' : key === '-' ? '_' : key;
    instance.vditor.ir.element.dispatchEvent(new KeyboardEvent('keydown', {
      key, shiftKey: shift, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true,
    }));
    if (action.startsWith('align') && oldRange && oldRange.startContainer.isConnected) {
      selection.removeAllRanges();
      selection.addRange(oldRange);
    }
    const anchor = selection.anchorNode;
    const element = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
    selectCell(element?.closest('td, th') ?? null);
    commitRich();
  }

  useLayoutEffect(() => {
    const extensions = sourceExtensions(sourceUpdate, latest, wrapping.current, sourceSpelling.current);
    const view = new EditorView({ parent: sourceHost.current, state: EditorState.create({ doc: sourceText(content.current.raw), extensions }) });
    source.current = view;
    return () => {
      view.destroy();
      source.current = null;
    };
  }, []);

  useEffect(() => {
    if (mode === 'live' && !richMounted) setRichMounted(true);
  }, [mode, richMounted]);

  useEffect(() => {
    source.current?.dispatch({ effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);

  useEffect(() => {
    if (mode !== 'read') return;
    const selectionChange = () => {
      const selection = window.getSelection();
      if (previewHost.current?.contains(selection?.anchorNode)) latest.current.onSelection?.(selection.toString());
    };
    document.addEventListener('selectionchange', selectionChange);
    return () => document.removeEventListener('selectionchange', selectionChange);
  }, [mode]);

  useEffect(() => {
    if (!richMounted) return;
    const host = richHost.current;
    let alive = true;
    let instance;
    let observer;
    let tables;
    let refreshHtml;
    const flush = (event) => {
      if (event.isComposing) return;
      queueMicrotask(() => {
        if (!alive) return;
        commitRich();
        if (event.type === 'compositionend') refreshHtml?.();
      });
    };
    let tabExitUntil = 0;
    const editBeforeInput = (event) => {
      const editable = instance?.vditor.ir.element;
      if (editable?.contains(event.target)) handleRichListTrigger(event, editable, instance.vditor);
    };
    const editKeys = (event) => {
      const editable = instance?.vditor.ir.element;
      if (!editable?.contains(event.target)) return;
      // Vditor handles these chords outside its toolbar shortcut configuration.
      if (event.altKey && event.ctrlKey !== event.metaKey && !event.shiftKey && /^Digit[1-9]$/.test(event.code)) {
        event.stopImmediatePropagation();
        return;
      }
      if (isComposingKey(event) || event.defaultPrevented) return;
      // Shift itself is part of the documented Escape → Shift+Tab exit.
      if (event.key === 'Shift') return;
      const nextTabExits = performance.now() < tabExitUntil;
      tabExitUntil = 0;
      if (event.key === 'Escape') {
        tabExitUntil = performance.now() + 2000;
        return;
      }
      const modified = event.ctrlKey || event.metaKey || event.altKey;
      if (event.key === 'Tab' && !modified && nextTabExits) {
        event.stopImmediatePropagation();
        return;
      }
      if (handleRichCodeKeys(event, editable)) return;
      if (handleRichListKeys(event, editable, instance.vditor)) return;
      if (handleRichHardBreak(event, editable, instance.vditor)) return;
      if (handleRichParagraphKeys(event, editable)) return;
      const addWithEnter = event.key === 'Enter' && !event.shiftKey && !event.altKey &&
        (/Mac/i.test(navigator.platform) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
      const forwardTab = event.key === 'Tab' && !modified && !event.shiftKey;
      const backwardTab = event.key === 'Tab' && !modified && event.shiftKey;
      if (!addWithEnter && !forwardTab && !backwardTab) return;

      const selection = window.getSelection();
      const anchor = backwardTab && selection?.rangeCount ? selection.getRangeAt(0).startContainer : selection?.anchorNode;
      const cell = (anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement)?.closest('td, th');
      if (backwardTab) {
        // The table handles reverse navigation. In other blocks without an
        // indentation action, keep the caret or selection until Escape is used.
        if (!cell || !editable.contains(cell)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      if (!cell || !editable.contains(cell)) return;
      const row = cell.parentElement;
      const table = cell.closest('table');
      if (forwardTab && (cell.nextElementSibling || table.rows[table.rows.length - 1] !== row)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      tableCommand(tableActions[1], cell);
      const next = table.rows[row.rowIndex + 1]?.cells[forwardTab ? 0 : cell.cellIndex];
      if (next) {
        window.getSelection().collapse(next, 0);
        next.scrollIntoView({ block: 'nearest' });
        selectCell(next);
      }
    };
    const selectionChange = () => {
      if (latest.current.mode !== 'live' || !rich.current) return;
      const anchor = window.getSelection()?.anchorNode;
      if (!anchor || !host.contains(anchor)) {
        if (activeCell.current) selectCell(null);
        setActiveFence(null);
        return;
      }
      const element = anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement;
      const selection = window.getSelection();
      const editor = rich.current.vditor.ir.element;
      if (editor.contains(anchor) && editor.contains(selection.focusNode)) {
        liveCaret.current = {
          anchor: caretPoint(editor, anchor, selection.anchorOffset),
          focus: caretPoint(editor, selection.focusNode, selection.focusOffset),
        };
      }
      const cell = element?.closest('td, th') ?? null;
      if (cell || activeCell.current) selectCell(cell);
      setActiveFence(codeFenceAt(element));
      const block = element?.closest('[data-block="0"]');
      if (block !== activeBlock.current) {
        activeBlock.current?.removeAttribute('data-sujian-active');
        block?.setAttribute('data-sujian-active', '');
        activeBlock.current = block;
      }
      latest.current.onSelection?.(rich.current.getSelection() ?? '');
    };

    // Vditor otherwise injects its icon script inline, which would require script-src unsafe-inline.
    Promise.all([
      loadVendorScript('vditorIconScript', 'icons/ant.js'),
      loadVendorScript('vditorLuteScript', 'lute/lute.min.js'),
    ]).then(() => {
      if (!alive) return;
      const dark = resolveTheme(latest.current.theme).scheme === 'dark';
      instance = new Vditor(host, {
        cdn: vendorRoot,
        value: content.current.raw,
        mode: 'ir',
        lang: 'zh_CN',
        theme: dark ? 'dark' : 'classic',
        icon: '',
        cache: { enable: false },
        height: '100%',
        toolbar: [...managedLiveTools.map(name => ({ name, hotkey: '' })), 'undo', 'redo'],
        toolbarConfig: { hide: true },
        link: { isOpen: false },
        image: { isPreview: false },
        preview: {
          markdown: markdownOptions,
          render: { media: { enable: false } },
          theme: { current: dark ? 'dark' : 'light' },
          hljs: { style: dark ? 'github-dark' : 'github', renderMenu: bindCodeCopy },
        },
        customRenders: ['sequence', 'flow', 'dot'].map((language) => ({
          language,
          render: (preview) => renderLegacyDiagram(preview, latest.current.theme),
        })),
        typewriterMode: latest.current.typewriter,
        input: commitRich,
        after: () => {
          if (!alive) {
            instance.destroy();
            return;
          }
          rich.current = instance;
          syncRich();
          const editable = instance.vditor.ir.element;
          tables = observeWideTables(editable);
          editable.setAttribute('aria-label', 'Markdown 即时编辑');
          editable.setAttribute('aria-description', '先按 Escape，再按 Tab 或 Shift+Tab 可移出编辑区。');
          editable.spellcheck = latest.current.spellcheck;
          setLiveTheme(instance, latest.current.theme);
          liveDetails.current = createLiveHtmlDetails(editable);
          refreshHtml = () => {
            if (instance.vditor.ir.composingLock) return;
            decorateLiveInlineHtml(editable);
            if (latest.current.spellcheck) decorateLiveSpellcheck(editable);
            liveDetails.current.refresh(content.current.id);
          };
          const decorate = () => {
            resolveLiveAssets();
            refreshHtml();
            renderLiveGithubMath(editable);
            tables.refresh();
            for (const preview of normalizeLiveFencePreviews(editable, currentFenceSources())) {
              void highlightCode(preview, latest.current.theme, true).catch(() => {});
            }
          };
          observer = new MutationObserver(decorate);
          observer.observe(editable, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src'] });
          decorate();
          if (latest.current.mode === 'live' && pendingLiveFocus.current === content.current.id) instance.focus();
          pendingLiveFocus.current = null;
        },
      });
    }).catch((error) => {
      if (alive) setRichError(error.message);
    });

    host.addEventListener('input', flush, true);
    host.addEventListener('beforeinput', editBeforeInput, true);
    host.addEventListener('compositionend', flush, true);
    host.addEventListener('keydown', editKeys, true);
    document.addEventListener('selectionchange', selectionChange);
    return () => {
      alive = false;
      host.removeEventListener('input', flush, true);
      host.removeEventListener('beforeinput', editBeforeInput, true);
      host.removeEventListener('compositionend', flush, true);
      host.removeEventListener('keydown', editKeys, true);
      document.removeEventListener('selectionchange', selectionChange);
      observer?.disconnect();
      tables?.disconnect();
      liveDetails.current?.dispose();
      liveDetails.current = null;
      if (rich.current) {
        rich.current.destroy();
        rich.current = null;
      }
    };
  }, [richMounted]);

  useLayoutEffect(() => {
    const changedDocument = content.current.id !== docId;
    const changedText = content.current.raw !== value;
    const view = source.current;
    const richElement = rich.current?.vditor.ir.element;
    const remembered = tabMemory.current.get(docId);
    if (changedDocument) {
      const previous = content.current;
      const state = tabMemory.current.get(previous.id) ?? {};
      if (view) {
        state.source = view.state;
        state.sourceScroll = { top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft };
      }
      if (richElement && previous.rich !== null) {
        state.live = { raw: previous.raw, caret: liveCaret.current, top: richElement.scrollTop, left: richElement.scrollLeft };
      }
      tabMemory.current.delete(previous.id);
      tabMemory.current.set(previous.id, state);
      if (tabMemory.current.size > 16) tabMemory.current.delete(tabMemory.current.keys().next().value);
      content.current.id = docId;
      liveCaret.current = remembered?.live?.caret ?? null;
      imageCache.current.clear();
      lastFind.current = null;
      selectCell(null);
      editorContext.current = null;
      setActiveFence(null);
      setHoveredFence(null);
      setLanguageRequest(null);
      latest.current.onSelection?.('');
    }

    if (changedText || changedDocument) content.current.raw = value;

    const next = sourceText(content.current.raw);
    if (view && changedDocument) {
      const state = remembered?.source;
      if (state?.doc.toString() === next) {
        view.setState(state);
        view.dispatch({ effects: [wrapping.current.reconfigure(latest.current.wrap ? EditorView.lineWrapping : []),
          sourceSpelling.current.reconfigure(sourceSpellcheckSetting(latest.current.spellcheck))] });
      } else {
        view.setState(EditorState.create({ doc: next, extensions: sourceExtensions(sourceUpdate, latest, wrapping.current, sourceSpelling.current) }));
      }
      view.scrollDOM.scrollTo(remembered?.sourceScroll ?? { top: 0, left: 0 });
    } else if (view && view.state.doc.toString() !== next && (mode !== 'live' || changedText)) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        annotations: [externalEdit.of(true), Transaction.addToHistory.of(false)],
      });
    }

    if (mode === 'live' && (changedDocument || changedText || content.current.rich === null)) {
      syncRich();
      if (richElement && remembered?.live?.raw === value) {
        restoreCaret(richElement, remembered.live.caret);
        richElement.scrollTo({ top: remembered.live.top, left: remembered.live.left });
      } else if (richElement && changedDocument) {
        richElement.scrollTo({ top: 0, left: 0 });
      }
    }
    if (mode !== 'live') {
      content.current.rich = null;
      if (activeCell.current) selectCell(null);
    }
  }, [docId, mode, value]);

  useLayoutEffect(() => {
    source.current?.dispatch({ effects: sourceSpelling.current.reconfigure(sourceSpellcheckSetting(spellcheck)) });
    const editable = rich.current?.vditor.ir.element;
    if (editable) {
      editable.spellcheck = spellcheck;
      if (spellcheck && !rich.current.vditor.ir.composingLock) decorateLiveSpellcheck(editable);
    }
  }, [spellcheck]);

  useEffect(() => {
    if (rich.current) {
      rich.current.vditor.options.typewriterMode = typewriter;
      setLiveTheme(rich.current, theme);
    }
  }, [theme, typewriter, docId]);

  useEffect(() => {
    imageCache.current.clear();
    const images = rich.current?.vditor.ir.element.querySelectorAll('img[data-sujian-source]') ?? [];
    for (const image of images) {
      delete image.dataset.sujianSource;
      image.removeAttribute('srcset');
    }
    resolveLiveAssets();
  }, [docId, resolveImage, assetUrl]);

  useEffect(() => {
    if (mode !== 'split' && mode !== 'read') return;
    const preview = previewHost.current;
    let alive = true;
    let tables;
    const timer = setTimeout(() => {
      renderPreview(value, { resolveImage: latest.current.resolveImage ?? latest.current.assetUrl, theme, allowRemoteMedia }).then((article) => {
        if (!alive) return;
        setPreviewError('');
        preview.replaceChildren(article);
        tables = observeWideTables(article);
      }).catch((error) => {
        if (alive) setPreviewError(error.message);
      });
    }, 180);
    return () => {
      alive = false;
      tables?.disconnect();
      clearTimeout(timer);
    };
  }, [value, mode, docId, theme, allowRemoteMedia, resolveImage, assetUrl]);

  function command(name, payload) {
    if (latest.current.mode === 'read') return false;
    if (latest.current.mode === 'source' || latest.current.mode === 'split') {
      const view = source.current;
      if (!view) return false;
      view.focus();
      if (name === 'undo') return undo(view);
      if (name === 'redo') return redo(view);
      if (name === 'heading') return setSourceHeading(view, Number(payload?.level ?? payload ?? 1));
      if (name === 'indent' || name === 'outdent') return indentSource(view, name === 'outdent');
      if (removeSourceInlineFormat(view, name)) return true;
      if (formatSourceInlineSelection(view, name)) return true;
      let { from, to } = view.state.selection.main;
      const line = view.state.doc.lineAt(from);
      if (lineCommands.includes(name)) {
        const lastLine = view.state.doc.lineAt(to);
        from = line.from;
        to = to > from && lastLine.from === to ? to - 1 : lastLine.to;
      }
      const edit = formatMarkdown(name, payload, view.state.sliceDoc(from, to), view.state.sliceDoc(line.from, from));
      if (!edit) return false;
      view.dispatch({
        changes: { from, to, insert: edit.text },
        selection: EditorSelection.single(from + edit.offset, from + edit.offset + edit.length),
        scrollIntoView: true,
      });
      return true;
    }

    const instance = rich.current;
    if (!instance) return false;
    const toolbar = instance.vditor.toolbar.elements;
    instance.focus();
    if (name === 'link' && !ensureLinkCaret(instance.vditor.ir.element, liveCaret.current)) return false;
    if (formatLiveSelection(instance.vditor.ir.element, instance.vditor, name)) {
      commitRich();
      return true;
    }
    if (name === 'indent' || name === 'outdent') {
      instance.vditor.ir.element.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Tab', code: 'Tab', shiftKey: name === 'outdent', bubbles: true, cancelable: true,
      }));
    } else if (nativeCommands.includes(name)) {
      toolbar[name]?.firstElementChild?.click();
    } else if (name === 'heading' && Number(payload?.level ?? payload ?? 1) > 0) {
      const level = Math.max(1, Math.min(6, Math.floor(Number(payload?.level ?? payload ?? 1)) || 1));
      toolbar.headings?.querySelector(`[data-tag="h${level}"]`)?.click();
    } else if (name === 'heading') {
      const anchor = window.getSelection()?.anchorNode;
      const element = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
      const heading = element?.closest('h1, h2, h3, h4, h5, h6');
      if (!instance.vditor.ir.element.contains(heading)) return false;
      const button = toolbar.headings?.firstElementChild;
      button?.classList.add('vditor-menu--current');
      button?.click();
    } else {
      const edit = formatMarkdown(name, payload, instance.getSelection() ?? '');
      if (!edit) return false;
      instance.insertMD(edit.text);
    }
    commitRich();
    return true;
  }

  function find(query, options = {}) {
    if (!query) {
      lastFind.current = null;
      return null;
    }
    const key = JSON.stringify([query, Boolean(options.caseSensitive), Boolean(options.wholeWord), Boolean(options.regex)]);
    const last = lastFind.current?.key === key ? lastFind.current : null;
    const offset = last ? last.index + (options.backward ? 0 : Math.max(last.length, 1)) : options.backward ? Infinity : 0;

    if (latest.current.mode === 'source' || latest.current.mode === 'split') {
      const view = source.current;
      if (!view) return null;
      const matches = matchMarkdown(view.state.doc.toString(), query, options);
      const match = nextMatch(matches, offset, options.backward);
      if (!match) return null;
      sourceSelection(view, match.index, match.index + match[0].length);
      lastFind.current = { key, index: match.index, length: match[0].length, ordinal: matches.indexOf(match) };
      return { index: matches.indexOf(match) + 1, count: matches.length };
    }

    const editable = latest.current.mode === 'read' ? previewHost.current : rich.current?.vditor.ir.element;
    if (!editable) return null;
    const { text, ranges } = visibleText(editable);
    const matches = matchMarkdown(text, query, options);
    const match = nextMatch(matches, offset, options.backward);
    if (!match) return null;
    selectRich(editable, ranges, match.index, match.index + match[0].length, liveDetails.current?.reveal);
    lastFind.current = { key, index: match.index, length: match[0].length, ordinal: matches.indexOf(match) };
    return { index: matches.indexOf(match) + 1, count: matches.length };
  }

  function replace(query, replacement, options = {}) {
    if (latest.current.mode === 'read') return 0;
    const sourceMode = latest.current.mode !== 'live';
    const view = source.current;
    const raw = sourceMode ? view.state.doc.toString() : content.current.raw;
    const matches = matchMarkdown(raw, query, options);
    const key = JSON.stringify([query, Boolean(options.caseSensitive), Boolean(options.wholeWord), Boolean(options.regex)]);
    const previous = lastFind.current?.key === key ? lastFind.current : null;
    const single = sourceMode ? nextMatch(matches, view.state.selection.main.from, false) : matches[previous?.ordinal ?? 0];
    const chosen = options.all ? matches : [single].filter(Boolean);
    if (!chosen.length) return 0;

    const changes = chosen.map((match) => ({
      from: match.index, to: match.index + match[0].length,
      insert: replacementText(match, replacement, options.regex),
    }));
    if (sourceMode) {
      view.dispatch({ changes });
    } else {
      let next = raw;
      for (const { from, to, insert } of changes.reverse()) next = next.slice(0, from) + insert + next.slice(to);
      publish(next);
      syncRich(false);
    }
    lastFind.current = null;
    return chosen.length;
  }

  function jump(number) {
    const lineNumber = Math.max(1, Math.floor(Number(number) || 1));
    if (latest.current.mode === 'source' || latest.current.mode === 'split') {
      const view = source.current;
      if (view) sourceSelection(view, view.state.doc.line(Math.min(lineNumber, view.state.doc.lines)).from);
      return;
    }

    const editable = latest.current.mode === 'read' ? previewHost.current : rich.current?.vditor.ir.element;
    if (!editable) return;
    const line = content.current.raw.split(/\r?\n/)[lineNumber - 1] ?? '';
    const heading = markdownHeading(line);
    const { text, ranges } = visibleText(editable);
    const needle = heading?.replace(/[*_`~]/g, '') ?? line.trim().replace(/^(?:>|[-*+]\s)/, '').trim();
    const offset = needle && text.indexOf(needle);
    if (needle && offset >= 0 && selectRich(editable, ranges, offset, offset, liveDetails.current?.reveal)) return;
    const blocks = editable.querySelectorAll('[data-block="0"]');
    const block = blocks[Math.min(Math.max(0, lineNumber - 1), blocks.length - 1)];
    if (block) {
      openEnclosingDetails(block, liveDetails.current?.reveal);
      block.scrollIntoView({ block: 'center' });
    }
  }

  useImperativeHandle(editorRef, () => ({
    command, find, replace, jump, contextCommand,
    focus: () => {
      if (latest.current.mode === 'live') {
        if (rich.current) rich.current.focus();
        else pendingLiveFocus.current = content.current.id;
      } else if (latest.current.mode === 'read') previewHost.current?.focus();
      else source.current?.focus();
    },
    getSelection: () => {
      if (latest.current.mode === 'live') return rich.current?.getSelection() ?? '';
      if (latest.current.mode === 'read') {
        const selection = window.getSelection();
        return previewHost.current?.contains(selection?.anchorNode) ? selection.toString() : '';
      }
      const view = source.current;
      const range = view?.state.selection.main;
      return range ? view.state.sliceDoc(range.from, range.to) : '';
    },
    getLiveMarkdownSelection: () => {
      const instance = rich.current;
      const selection = window.getSelection();
      if (latest.current.mode !== 'live' || !instance || !selection?.rangeCount || selection.isCollapsed) return '';
      const range = selection.getRangeAt(0);
      const editable = instance.vditor.ir.element;
      return editable.contains(range.startContainer) && editable.contains(range.endContainer) ? liveSelectionMarkdown(instance, range) : '';
    },
    getValue: () => {
      commitRich();
      return content.current.raw;
    },
  }));

  function handleLink(event) {
    const link = event.target.closest?.('a[href]');
    const href = link?.getAttribute('href') ||
      ((event.ctrlKey || event.metaKey) && latest.current.mode === 'live' ? linkAddress(event.target) : null);
    if (!href) return;
    event.preventDefault();
    openHref(href, event.target.closest('.editor-preview, .editor-live'));
  }

  function openHref(href, pane) {
    if (href.startsWith('#')) {
      const contentRoot = pane?.classList.contains('editor-live') ? rich.current?.vditor.ir.element : previewHost.current;
      scrollToMarkdownAnchor(contentRoot, href.slice(1), liveDetails.current?.reveal);
      return;
    }
    latest.current.onLink?.(href);
  }

  function editorContextTarget(target) {
    const editable = rich.current?.vditor.ir.element;
    if (mode === 'live' && editable?.contains(target)) return { root: editable, editable: true };
    if (mode !== 'live' && target.closest?.('.editor-preview') && previewHost.current) {
      return { root: previewHost.current, editable: false };
    }
    if ((mode === 'source' || mode === 'split') && sourceHost.current?.contains(target) && source.current) {
      return { view: source.current };
    }
    return null;
  }

  function captureContextPointer(event) {
    contextPointer.current = null;
    const macControlClick = desktop.platform === 'darwin' && event.button === 0 && event.ctrlKey && event.pointerType === 'mouse';
    if (!onContextMenu || (event.button !== 2 && !macControlClick)) return;
    const target = editorContextTarget(event.target);
    if (target) contextPointer.current = {
      snapshot: contextSelection(target), docId, mode, x: event.clientX, y: event.clientY, time: event.timeStamp,
    };
  }

  function showEditorContext(event) {
    if (!onContextMenu || event.defaultPrevented) return;
    const keyboard = event.type === 'keydown' || (!event.clientX && !event.clientY);
    const target = editorContextTarget(event.target);
    if (!target) return;
    const pointer = contextPointer.current;
    contextPointer.current = null;
    const samePointer = !keyboard && pointer?.docId === docId && pointer.mode === mode &&
      Math.abs(pointer.x - event.clientX) <= 1 && Math.abs(pointer.y - event.clientY) <= 1 && event.timeStamp - pointer.time < 2000;
    const snapshot = samePointer ? pointer.snapshot : undefined;
    const context = target.view ? sourceContext(event, target.view, keyboard, snapshot) :
      domContext(event, target.root, target.editable, keyboard, snapshot);

    const image = event.target.closest?.('img');
    const imageTarget = !keyboard && desktop.copyImageAt && target.root?.contains(image) && image.complete && image.naturalWidth
      ? { element: image, source: image.currentSrc, x: event.clientX, y: event.clientY } : null;
    const canCheckSpelling = spellcheck && context.editable && !context.selection && !imageTarget && context.kind !== 'code';
    const spelling = canCheckSpelling ? (context.view
      ? sourceSpellingAt(context.view.state, context.sourceOffset, desktop.spellingSuggestions)
      : spellingAt(context.root, context.range, desktop.spellingSuggestions)) : null;
    editorContext.current = { ...context, mode, docId, spelling, imageTarget };
    onContextMenu(event, {
      selection: context.selection, editable: context.editable, mode, kind: context.kind,
      href: context.href, position: context.position,
      canCopyImage: Boolean(imageTarget),
      canPaste: context.editable && Boolean(desktop.editClipboard || navigator.clipboard?.readText),
      language: context.editable && context.block ? codeFenceLanguage(context.block, editorFenceSource(context.block)) : undefined,
      header: context.cell?.tagName === 'TH', columnCount: context.cell?.parentElement.cells.length,
      spelling: spelling && { word: spelling.word, suggestions: spelling.suggestions },
    });
  }

  function contextCommand(id, payload) {
    const context = editorContext.current;
    if (!context || context.docId !== content.current.id || context.mode !== latest.current.mode) return false;
    if (id === 'copy-image' && context.imageTarget) return copyContextImage(context);
    if (id === 'copy-code' && context.codeText !== undefined) return desktop.writeClipboard({ text: context.codeText });
    if (id === 'copy-link' && context.href) return desktop.writeClipboard({ text: context.href });
    if (id === 'open-link' && context.href) return openHref(context.href, context.root?.closest('.editor-preview, .editor-live'));
    if (!restoreEditorContext(context)) return false;
    if (id === 'restore-focus') return true;
    if (id === 'select-all') {
      if (context.view) context.view.dispatch({ selection: { anchor: 0, head: context.doc.length } });
      else context.root.ownerDocument.getSelection().selectAllChildren(context.root);
      return true;
    }
    if (id === 'copy' || id === 'cut') return copyContextSelection(context, id === 'cut');
    if (!context.editable) return false;
    if (id === 'add-to-dictionary' && latest.current.spellcheck && context.spelling) return desktop.addSpellingWord(context.spelling.word);
    if (id.startsWith('spelling-') && latest.current.spellcheck && context.spelling) {
      const { from, to, range, suggestions, word } = context.spelling;
      const replacement = suggestions[Number(id.slice('spelling-'.length))];
      if (!replacement) return false;
      if (context.view) {
        if (context.view.state.sliceDoc(from, to) !== word) return false;
        context.view.dispatch({
          changes: { from, to, insert: replacement }, selection: { anchor: from + replacement.length }, userEvent: 'input',
        });
        return true;
      }
      if (!context.root.contains(range.startContainer) || range.toString() !== word) return false;
      const selection = context.root.ownerDocument.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return document.execCommand('insertText', false, replacement);
    }
    if (id === 'code-language' && context.block?.isConnected) {
      setLanguageRequest({ block: context.block });
      return true;
    }
    if (tableContextActions[id] && context.cell?.isConnected) return tableCommand(tableContextActions[id], context.cell);
    if (['bold', 'italic', 'strike', 'inline-code', 'underline', 'link', 'table', 'code', 'undo', 'redo'].includes(id)) return command(id, payload);
    if (!Object.hasOwn(pasteActions, id)) return false;
    if (desktop.editClipboard) return desktop.editClipboard(pasteActions[id]);
    return navigator.clipboard.readText().then(text => {
      if (context.docId === content.current.id && context.mode === latest.current.mode && restoreEditorContext(context)) {
        document.execCommand('insertText', false, text);
      }
    });
  }

  async function copyContextImage(context) {
    const { element, source, x, y } = context.imageTarget;
    const isCurrent = () => editorContext.current === context && context.docId === content.current.id &&
      context.mode === latest.current.mode && context.root.contains(element) && element.currentSrc === source;
    // Encode local pixels directly, so paste targets never have to follow an app-only URL.
    if (/^(?:sujian-asset:|blob:|data:image\/)/i.test(source)) {
      let png;
      try {
        let image = element;
        if (source.startsWith('sujian-asset:')) {
          const embedded = await embedImage?.(source);
          if (!embedded?.startsWith('data:image/')) throw new Error('图片资源不可用。');
          image = new Image();
          image.src = embedded;
          await image.decode();
        }
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      } catch {
        // If the decoded image cannot be exported to canvas, try Chromium's copy command.
      }
      if (png) {
        const bytes = new Uint8Array(await png.arrayBuffer());
        if (isCurrent()) return desktop.writeClipboardImage(bytes);
        return false;
      }
    }
    // Let the menu close before Chromium hit-tests the document at this point.
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (!isCurrent()) return false;
    if (element.ownerDocument.elementFromPoint(x, y) !== element) {
      throw new Error('图片已离开当前视野，请重新右击图片。');
    }
    return desktop.copyImageAt({ x, y });
  }

  async function copyContextSelection(context, cut) {
    if (!context.selection || (cut && !context.editable)) return false;
    const raw = content.current.raw;
    const selection = context.view ? context.sourceSelection.main : context.range;
    const visible = context.view ? context.doc.sliceString(selection.from, selection.to) : selection.toString();
    let text = visible;
    if (context.editable && !context.view && rich.current) text = liveSelectionMarkdown(rich.current, selection);
    await desktop.writeClipboard({ text });
    if (!cut || editorContext.current !== context || context.docId !== content.current.id || context.mode !== latest.current.mode ||
        content.current.raw !== raw || !restoreEditorContext(context)) return true;
    if (context.view) context.view.dispatch({ ...context.view.state.replaceSelection(''), userEvent: 'delete.cut' });
    else document.execCommand('delete');
    return true;
  }

  function handleFiles(event) {
    const files = [...(event.clipboardData?.files ?? event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/'));
    if (!files.length || !latest.current.onImage) return;
    event.preventDefault();
    event.stopPropagation();
    latest.current.onImage(files);
  }

  return (
    <div className={`editor-surface editor-mode-${mode}${focusMode ? ' editor-focus-mode' : ''}${typewriter ? ' editor-typewriter' : ''}`}
      onClickCapture={handleLink} onPasteCapture={handleFiles} onDropCapture={handleFiles} onPointerDownCapture={captureContextPointer}
      onContextMenu={showEditorContext} onKeyDown={event => {
        if (!isComposingKey(event.nativeEvent) && !event.ctrlKey && !event.metaKey && !event.altKey &&
          (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) showEditorContext(event);
      }}>
      <div className="editor-live" hidden={mode !== 'live'} onPointerMove={event => {
        if (!event.target.closest('.editor-code-language')) setHoveredFence(codeFenceAt(event.target));
      }} onPointerLeave={() => setHoveredFence(null)}>
        <div className="editor-rich-host" ref={richHost} />
        {mode === 'live' && <CodeLanguageControl key={docId}
          target={hoveredFence?.isConnected ? hoveredFence : activeFence}
          request={languageRequest}
          sourceFor={editorFenceSource} onChange={applyCodeFenceLanguage}/>}
        {tableSelection && <div className="editor-table-toolbar" role="toolbar" aria-label="表格编辑">
          {tableActions.map((entry) => {
            const [action, label] = entry;
            const header = tableSelection.startsWith('header');
            const disabled = (header && (action === 'rowAbove' || action === 'deleteRow')) || (tableSelection.endsWith('-1') && action === 'deleteColumn');
            return <button key={action} type="button" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => tableCommand(entry)}>{label}</button>;
          })}
        </div>}
        {richError && <div role="alert" className="editor-error">{richError}</div>}
      </div>
      <div className="editor-source" hidden={mode !== 'source' && mode !== 'split'} ref={sourceHost} />
      <div className="editor-preview" hidden={mode !== 'split' && mode !== 'read'}>
        <div ref={previewHost} tabIndex={mode === 'read' ? 0 : -1} />
        {previewError && <div role="alert" className="editor-error">{previewError}</div>}
      </div>
    </div>
  );
}

export default Editor;

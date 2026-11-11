import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Annotation, Compartment, EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView, drawSelection, dropCursor, highlightActiveLine, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { formatMarkdown } from './format.js';
import { matchMarkdown, projectMarkdownEdit, replacementText } from './markdown-edits.js';
import { isLocalImage, loadVendorScript, markdownOptions, renderLegacyDiagram, renderPreview, vendorRoot } from './render-document.js';
import './editor.css';

const nativeCommands = ['bold', 'italic', 'strike', 'inline-code', 'quote', 'list', 'ordered-list', 'check', 'indent', 'outdent', 'undo', 'redo'];
const lineCommands = ['heading', 'quote', 'list', 'ordered-list', 'check', 'indent', 'outdent'];
const sourceText = (value) => value.replace(/\r\n?/g, '\n');
const externalEdit = Annotation.define();
const tableActions = [
  ['rowAbove', '上方加行', 'f', true], ['rowBelow', '下方加行', '='],
  ['columnLeft', '左侧加列', 'g', true], ['columnRight', '右侧加列', '=', true],
  ['deleteRow', '删行', '-'], ['deleteColumn', '删列', '-', true],
  ['alignLeft', '左对齐', 'l', true], ['alignCenter', '居中', 'c', true], ['alignRight', '右对齐', 'r', true],
];

function sourceExtensions(onUpdate, latest, wrapping) {
  return [
    markdown(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    history(), drawSelection(), dropCursor(), highlightActiveLine(),
    wrapping.of(latest.current.wrap ? EditorView.lineWrapping : []),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown 源码' }),
    EditorView.scrollMargins.of((view) => {
      if (!latest.current.typewriter) return null;
      const margin = Math.round(view.scrollDOM.clientHeight * 0.35);
      return { top: margin, bottom: margin };
    }),
    EditorView.updateListener.of(onUpdate),
  ];
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

function selectRich(editor, ranges, from, to) {
  const start = ranges.find((range) => range.from <= from && range.to > from);
  const end = ranges.find((range) => range.from < to && range.to >= to) ?? start;
  if (!start || !end) return false;

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

function updateUnderlines(root) {
  if (!CSS.highlights || typeof Highlight !== 'function') return;
  const openings = [];
  const ranges = [];
  for (const marker of root.querySelectorAll('[data-type="html-inline"] > code')) {
    const syntax = marker.textContent.trim();
    if (/^<u(?:\s[^>]*)?>$/i.test(syntax)) openings.push(marker.parentElement);
    if (/^<\/u\s*>$/i.test(syntax) && openings.length) {
      const range = document.createRange();
      range.setStartAfter(openings.pop());
      range.setEndBefore(marker.parentElement);
      ranges.push(range);
    }
  }
  CSS.highlights.set('sujian-underline', new Highlight(...ranges));
}

export function Editor({
  docId, value = '', mode = 'live', onChange, onSelection, onLink, onImage, resolveImage,
  assetUrl, focusMode = false, typewriter = false, spellcheck = false, wrap = true, allowRemoteMedia = true, theme = 'light', editorRef,
}) {
  const richHost = useRef(null);
  const sourceHost = useRef(null);
  const previewHost = useRef(null);
  const rich = useRef(null);
  const source = useRef(null);
  const wrapping = useRef(new Compartment());
  const latest = useRef(null);
  const content = useRef({ id: docId, raw: value, rich: null });
  const imageCache = useRef(new Map());
  const tabMemory = useRef(new Map());
  const liveCaret = useRef(null);
  const lastFind = useRef(null);
  const activeBlock = useRef(null);
  const activeCell = useRef(null);
  const [tableSelection, setTableSelection] = useState(null);
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
    if (next === before) return;
    content.current.rich = next;
    publish(projectMarkdownEdit(content.current.raw, before, next));
  }

  function syncRich(clearHistory = true) {
    if (!rich.current) return;
    rich.current.setValue(content.current.raw, clearHistory);
    content.current.rich = rich.current.getValue();
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

  function tableCommand([action, , baseKey, shiftKey = false]) {
    const instance = rich.current;
    let cell = activeCell.current;
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
    const extensions = sourceExtensions(sourceUpdate, latest, wrapping.current);
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
    const flush = (event) => {
      if (!event.isComposing) queueMicrotask(commitRich);
    };
    const selectionChange = () => {
      if (latest.current.mode !== 'live' || !rich.current) return;
      const anchor = window.getSelection()?.anchorNode;
      if (!anchor || !host.contains(anchor)) {
        if (activeCell.current) selectCell(null);
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
      instance = new Vditor(host, {
        cdn: vendorRoot,
        value: content.current.raw,
        mode: 'ir',
        lang: 'zh_CN',
        theme: latest.current.theme === 'dark' ? 'dark' : 'classic',
        icon: '',
        cache: { enable: false },
        height: '100%',
        toolbar: ['headings', ...nativeCommands, 'link', 'code', 'line', 'table'],
        toolbarConfig: { hide: true },
        link: { isOpen: false },
        image: { isPreview: false },
        preview: { markdown: markdownOptions, render: { media: { enable: false } } },
        customRenders: ['sequence', 'flow'].map((language) => ({
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
          editable.setAttribute('aria-label', 'Markdown 即时编辑');
          editable.spellcheck = latest.current.spellcheck;
          if (latest.current.theme === 'dark') instance.setTheme('dark', 'dark');
          const decorate = () => {
            resolveLiveAssets();
            updateUnderlines(editable);
          };
          observer = new MutationObserver(decorate);
          observer.observe(editable, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src'] });
          resolveLiveAssets();
          updateUnderlines(editable);
        },
      });
    }).catch((error) => {
      if (alive) setRichError(error.message);
    });

    host.addEventListener('input', flush, true);
    host.addEventListener('compositionend', flush, true);
    document.addEventListener('selectionchange', selectionChange);
    return () => {
      alive = false;
      host.removeEventListener('input', flush, true);
      host.removeEventListener('compositionend', flush, true);
      document.removeEventListener('selectionchange', selectionChange);
      observer?.disconnect();
      CSS.highlights?.delete('sujian-underline');
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
      latest.current.onSelection?.('');
    }

    if (changedText || changedDocument) content.current.raw = value;

    const next = sourceText(content.current.raw);
    if (view && changedDocument) {
      const state = remembered?.source;
      if (state?.doc.toString() === next) {
        view.setState(state);
        view.dispatch({ effects: wrapping.current.reconfigure(latest.current.wrap ? EditorView.lineWrapping : []) });
      } else {
        view.setState(EditorState.create({ doc: next, extensions: sourceExtensions(sourceUpdate, latest, wrapping.current) }));
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

  useEffect(() => {
    if (source.current) source.current.contentDOM.spellcheck = spellcheck;
    if (rich.current) {
      rich.current.vditor.ir.element.spellcheck = spellcheck;
      rich.current.vditor.options.typewriterMode = typewriter;
      rich.current.setTheme(theme === 'dark' ? 'dark' : 'classic', theme === 'dark' ? 'dark' : 'light');
    }
  }, [spellcheck, theme, typewriter, docId]);

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
    const timer = setTimeout(() => {
      renderPreview(value, { resolveImage: latest.current.resolveImage ?? latest.current.assetUrl, theme, allowRemoteMedia }).then((article) => {
        if (!alive) return;
        setPreviewError('');
        preview.replaceChildren(article);
      }).catch((error) => {
        if (alive) setPreviewError(error.message);
      });
    }, 180);
    return () => {
      alive = false;
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
    if (nativeCommands.includes(name)) {
      toolbar[name]?.firstElementChild?.click();
    } else if (name === 'heading' && Number(payload?.level ?? payload ?? 1) > 0) {
      const level = Math.max(1, Math.min(6, Math.floor(Number(payload?.level ?? payload ?? 1)) || 1));
      toolbar.headings?.querySelector(`[data-tag="h${level}"]`)?.click();
    } else if (name === 'heading') {
      toolbar.headings?.firstElementChild?.click();
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
    selectRich(editable, ranges, match.index, match.index + match[0].length);
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
    if (needle && offset >= 0 && selectRich(editable, ranges, offset, offset)) return;
    const blocks = editable.querySelectorAll('[data-block="0"]');
    blocks[Math.min(Math.max(0, lineNumber - 1), blocks.length - 1)]?.scrollIntoView({ block: 'center' });
  }

  useImperativeHandle(editorRef, () => ({
    command, find, replace, jump,
    focus: () => {
      if (latest.current.mode === 'live') rich.current?.focus();
      else if (latest.current.mode === 'read') previewHost.current?.focus();
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
    getValue: () => {
      commitRich();
      return content.current.raw;
    },
  }));

  function handleLink(event) {
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href) return;
    event.preventDefault();
    if (href.startsWith('#')) {
      const name = href.slice(1);
      let anchor = name;
      try { anchor = decodeURIComponent(name); } catch { /* malformed URL */ }
      const pane = link.closest('.editor-preview, .editor-live');
      pane?.querySelector(`[id="${CSS.escape(anchor)}"], [data-id="${CSS.escape(anchor)}"]`)?.scrollIntoView({ block: 'start' });
      return;
    }
    latest.current.onLink?.(href);
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
      onClickCapture={handleLink} onPasteCapture={handleFiles} onDropCapture={handleFiles}>
      <div className="editor-live" hidden={mode !== 'live'}>
        <div className="editor-rich-host" ref={richHost} />
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
        <div ref={previewHost} tabIndex={mode === 'read' ? 0 : undefined} />
        {previewError && <div role="alert" className="editor-error">{previewError}</div>}
      </div>
    </div>
  );
}

export default Editor;

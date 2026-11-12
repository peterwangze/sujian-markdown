import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { CodeLanguagePicker } from './CodeLanguagePicker.jsx';
import { fenceInfo, replaceFenceLanguage } from './fence-info.js';

const fenceSelector = '[data-type="code-block"]:has(> [data-type="code-block-info"])';
const languageInfo = block => block.querySelector(':scope > [data-type="code-block-info"]');
const infoText = info => info?.textContent.replace(/^\u200b/, '') ?? '';
const codeMarker = block => block?.querySelector(':scope > pre.vditor-ir__marker--pre > code');

export function codeFenceAt(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest(fenceSelector) ?? null;
}

function matchingSource(block, source) {
  if (!source || !block.matches(fenceSelector)) return null;
  const shown = infoText(languageInfo(block)).trim();
  const prefix = /^\S+/.exec(source.value.trim())?.[0];
  const firstLine = codeMarker(block)?.textContent.split(/\r?\n/, 1)[0].replace(/\u200b/g, '').trim();
  return shown === prefix && firstLine === source.firstLine ? source : null;
}

export function codeFenceSource(editable, block, sources) {
  if (!sources.length) return null;
  const blocks = Array.from(editable.querySelectorAll('[data-type="code-block"]'));
  return blocks.length === sources.length ? matchingSource(block, sources[blocks.indexOf(block)]) : null;
}

export function liveFenceHistorySources(editable, sources) {
  if (!sources.some(Boolean)) return sources;
  const blocks = editable.querySelectorAll('[data-type="code-block"]');
  if (blocks.length !== sources.length) return sources;
  return sources.map((source, index) => {
    if (!source) return null;
    const block = blocks[index];
    // Vditor snapshots the live DOM for undo, but serializes only the first
    // token of the fence header. Keep the complete source in that snapshot.
    const saved = block.dataset.sujianFenceInfo;
    if (saved) return { value: saved };
    if (matchingSource(block, source)) block.dataset.sujianFenceInfo = source.value;
    return source;
  });
}

export function codeFenceLanguage(block, source) {
  const info = fenceInfo(source?.value ?? infoText(languageInfo(block)));
  return info.kind === 'opaque' ? undefined : info.language;
}

export function normalizeLiveFencePreviews(editable, sources) {
  const previews = [];
  const blocks = editable.querySelectorAll('[data-type="code-block"]');
  for (const [index, block] of blocks.entries()) {
    if (!block.matches(fenceSelector)) continue;
    const source = blocks.length === sources.length ? matchingSource(block, sources[index]) : null;
    const { kind, language } = fenceInfo(source?.value ?? infoText(languageInfo(block)));
    if ((kind !== 'attributes' && kind !== 'cell') || !language) continue;
    const preview = block.querySelector(':scope > .vditor-ir__preview');
    const code = preview?.matches('pre') ? preview.querySelector(':scope > code') : preview?.querySelector(':scope > pre > code');
    if (!code) continue;
    const normalized = 'language-' + language;
    if (code.classList.contains(normalized)) continue;
    for (const name of [...code.classList]) if (name.startsWith('language-')) code.classList.remove(name);
    code.classList.add(normalized);
    previews.push(preview);
  }
  return previews;
}

export function focusCodeFence(editable, block) {
  editable.focus({ preventScroll: true });
  editable.ownerDocument.getSelection().collapse(codeMarker(block) ?? editable, 0);
}

export function changeFenceLanguage(editable, block, language) {
  const info = languageInfo(block);
  if (!info || !editable.contains(block)) return false;
  const previous = infoText(info);
  const next = replaceFenceLanguage(previous, language);
  if (next === null) return false;
  focusCodeFence(editable, block);
  if (previous === next) return true;
  info.textContent = '\u200b' + next;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  return true;
}

export function CodeLanguageControl({ target, request, sourceFor, onChange }) {
  const [selected, setSelected] = useState(null);
  const [position, setPosition] = useState(null);
  const control = useRef(null);
  const previousCaret = useRef(null);
  const block = selected?.isConnected ? selected : target;
  const info = block?.isConnected ? fenceInfo(sourceFor(block)?.value ?? infoText(languageInfo(block))) : null;
  const language = info?.language;

  useLayoutEffect(() => {
    if (request?.block.isConnected) openPicker(request.block);
  }, [request]);

  function openPicker(block) {
    const selection = block.ownerDocument.getSelection();
    previousCaret.current = selection?.rangeCount && block.contains(selection.anchorNode) && block.contains(selection.focusNode)
      ? [selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset] : null;
    setSelected(block);
  }

  useLayoutEffect(() => {
    if (!block?.isConnected) return;
    const panel = block.closest('.editor-live');
    const scroller = block.closest('.vditor-reset');
    if (!panel || !scroller) return;

    function place() {
      if (!block.isConnected) {
        setPosition(null);
        return;
      }
      const bounds = block.getBoundingClientRect();
      const root = panel.getBoundingClientRect();
      const visible = scroller.getBoundingClientRect();
      if (bounds.top >= visible.bottom || bounds.bottom <= visible.top) {
        setPosition(null);
        setSelected(null);
        return;
      }
      setPosition({ x: Math.min(bounds.right, visible.right) - root.left - 9,
        y: Math.min(bounds.bottom, visible.bottom) - root.top - 8 });
    }
    const observer = new ResizeObserver(place);
    observer.observe(block);
    observer.observe(panel);
    scroller.addEventListener('scroll', place, { passive: true });
    place();
    return () => {
      observer.disconnect();
      scroller.removeEventListener('scroll', place);
    };
  }, [block]);

  useLayoutEffect(() => {
    if (!selected) return;
    function dismiss(event) {
      if (!control.current?.contains(event.target)) setSelected(null);
    }
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [selected]);

  if (!block?.isConnected || !position || info.kind === 'opaque') return null;
  const open = selected === block;
  const close = () => {
    setSelected(null);
    const editor = block.closest('[contenteditable="true"]');
    editor?.focus({ preventScroll: true });
    const selection = block.ownerDocument.getSelection();
    const previous = previousCaret.current;
    if (previous && block.contains(previous[0]) && block.contains(previous[2])) selection.setBaseAndExtent(...previous);
    else selection.collapse(block.querySelector(':scope > pre.vditor-ir__marker--pre > code') ?? block, 0);
  };
  return <div className="editor-code-language" ref={control} style={{ left: position.x, top: position.y }}
    data-open-below={position.y < 290} onBlur={event => {
      if (open && !event.currentTarget.contains(event.relatedTarget)) setSelected(null);
    }}>
    <button type="button" className="editor-code-language-trigger" aria-expanded={open} aria-haspopup="dialog"
      aria-label={'代码块语言 · ' + (language || '纯文本')} title="更改代码块语言"
      onMouseDown={event => event.preventDefault()} onClick={() => open ? close() : openPicker(block)}>
      <span>{language || '纯文本'}</span><ChevronDown size={13} aria-hidden="true"/>
    </button>
    {open && <div className="editor-code-language-popup">
      <CodeLanguagePicker language={language} allowPlain={info.kind !== 'cell'} onClose={close} onApply={value => {
        if (!onChange(block, value)) return;
        setSelected(null);
      }}/>
    </div>}
  </div>;
}

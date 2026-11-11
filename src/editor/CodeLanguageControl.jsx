import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { CodeLanguagePicker } from './CodeLanguagePicker.jsx';

const fenceSelector = '[data-type="code-block"]:has(> [data-type="code-block-info"])';
const languageInfo = block => block.querySelector(':scope > [data-type="code-block-info"]');
const languageToken = /^[A-Za-z0-9_+#.-]{1,48}$/;

export function codeFenceAt(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest(fenceSelector) ?? null;
}

export function changeFenceLanguage(editable, block, language) {
  const info = languageInfo(block);
  if (!info || !editable.contains(block) || (language && !languageToken.test(language))) return false;
  const previous = info.textContent.replace(/^\u200b/, '');
  const suffix = previous.match(/^\S+([ \t].*)$/)?.[1] ?? '';
  editable.focus({ preventScroll: true });
  const doc = editable.ownerDocument;
  const selection = doc.getSelection();
  const marker = block.querySelector(':scope > pre.vditor-ir__marker--pre > code');
  selection.collapse(marker ?? info, 0);
  const next = language ? language + suffix : '';
  if (previous === next) return true;
  info.textContent = '\u200b' + next;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  return true;
}

export function CodeLanguageControl({ target, request, onChange }) {
  const [selected, setSelected] = useState(null);
  const [position, setPosition] = useState(null);
  const control = useRef(null);
  const previousCaret = useRef(null);
  const block = selected?.isConnected ? selected : target;
  const language = block?.isConnected ? languageInfo(block)?.textContent.replace(/^\u200b/, '').trim().split(/\s+/)[0] : '';

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

  if (!block?.isConnected || !position) return null;
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
      <CodeLanguagePicker language={language} onClose={close} onApply={value => {
        if (!onChange(block, value)) return;
        setSelected(null);
      }}/>
    </div>}
  </div>;
}

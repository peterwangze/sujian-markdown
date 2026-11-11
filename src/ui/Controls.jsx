import { useEffect, useRef, useState } from 'react'
import { X, FileText } from 'lucide-react'
import { isComposingKey } from '../workspace/commands.js'
import { documentContextEvents } from './DocumentContextMenu.jsx'

export function IconButton({ icon: Icon, label, pressed, className = '', children, ...props }) {
  return <button className={'icon-button ' + className} type="button" title={label} aria-label={label} aria-pressed={pressed} {...props}>
    <Icon size={17} strokeWidth={1.7} />{children}
  </button>
}

export function Modal({ title, children, onClose, className = '', initialFocusRef }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    initialFocusRef?.current?.focus({ preventScroll: true })
    return () => dialog.close()
  }, [initialFocusRef])
  return <dialog ref={ref} className={'modal ' + className} aria-label={title}
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="modal-inner">
      <header><h2>{title}</h2><IconButton icon={X} label="关闭" onClick={onClose} /></header>
      {children}
    </div>
  </dialog>
}

export function TabStrip({ docs, active, isDirty, onSelect, onClose, onNew, onContext, plus: Plus }) {
  const ref = useRef(null)
  const addTab = useRef(null)
  const pendingClose = useRef(null)
  const [focusedTab, setFocusedTab] = useState(null)
  const tabbable = docs.some(doc => doc.id === focusedTab) ? focusedTab : active?.id ?? docs[0]?.id

  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active?.id])

  useEffect(() => {
    const tabs = ref.current
    function scrollTabs(event) {
      if (event.ctrlKey || event.shiftKey || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY) ||
        tabs.scrollWidth <= tabs.clientWidth) return
      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 :
        event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? tabs.clientWidth : 1
      event.preventDefault()
      tabs.scrollLeft += event.deltaY * multiplier
    }
    tabs.addEventListener('wheel', scrollTabs, { passive: false })
    return () => tabs.removeEventListener('wheel', scrollTabs)
  }, [])

  useEffect(() => {
    const pending = pendingClose.current
    if (!pending || docs.some(doc => doc.id === pending.id)) return
    pendingClose.current = null
    const focused = document.activeElement
    if (focused !== document.body && !ref.current?.contains(focused) && !focused?.closest('#write')) return
    const tabs = ref.current?.querySelectorAll('[role="tab"]')
    const target = tabs?.[Math.min(pending.index, tabs.length - 1)] ?? addTab.current
    target?.focus()
  }, [docs])

  function tabKey(event) {
    if (isComposingKey(event.nativeEvent) || event.ctrlKey || event.altKey || event.metaKey) return
    const tabs = Array.from(ref.current.querySelectorAll('[role="tab"]'))
    const index = tabs.indexOf(event.target)
    if (index < 0) return
    if (event.key === 'Delete') {
      event.preventDefault()
      pendingClose.current = { id: docs[index].id, index }
      onClose(docs[index].id)
      return
    }
    let next = null
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = tabs.length - 1
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    if (next !== null) {
      event.preventDefault()
      tabs[next].focus()
    }
  }

  return <div className="tab-strip">
    <div className="tabs" ref={ref} role="tablist" aria-label="打开的文档" onKeyDown={tabKey}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedTab(null) }}>
      {docs.map(doc => <div className={'tab ' + (active?.id === doc.id ? 'active' : '')} key={doc.id} role="presentation">
        <button type="button" role="tab" id={'doc-tab-' + doc.id} tabIndex={tabbable === doc.id ? 0 : -1}
          aria-selected={active?.id === doc.id} aria-controls={active?.id === doc.id ? 'write' : undefined} title={doc.path || doc.name}
          {...documentContextEvents({ kind: 'file', id: doc.id, path: doc.path, name: doc.name }, onContext)}
          onFocus={() => setFocusedTab(doc.id)}
          onClick={() => onSelect(doc.id)} onAuxClick={event => { if (event.button === 1) onClose(doc.id) }}>
          <FileText size={14} /><span>{doc.name}</span>{isDirty(doc) && <i title="有未保存的改动" />}
        </button>
        <button type="button" className="tab-close" tabIndex={-1} title="关闭标签 · Delete" aria-label={'关闭 ' + doc.name}
          onClick={() => onClose(doc.id)}><X size={14}/></button>
      </div>)}
    </div>
    <IconButton ref={addTab} icon={Plus} label="新建文档" onClick={onNew} />
  </div>
}

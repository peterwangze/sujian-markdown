import { useEffect, useRef } from 'react'
import { X, FileText } from 'lucide-react'

export function IconButton({ icon: Icon, label, pressed, className = '', children, ...props }) {
  return <button className={'icon-button ' + className} type="button" title={label} aria-label={label} aria-pressed={pressed} {...props}>
    <Icon size={17} strokeWidth={1.7} />{children}
  </button>
}

export function Modal({ title, children, onClose, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog ref={ref} className={'modal ' + className} aria-label={title}
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="modal-inner">
      <header><h2>{title}</h2><IconButton icon={X} label="关闭" onClick={onClose} /></header>
      {children}
    </div>
  </dialog>
}

export function TabStrip({ docs, active, isDirty, onSelect, onClose, onNew, plus: Plus }) {
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active?.id])
  return <div className="tab-strip">
    <div className="tabs" ref={ref} role="tablist" aria-label="打开的文档">
      {docs.map(doc => <div className={'tab ' + (active?.id === doc.id ? 'active' : '')} key={doc.id}>
        <button type="button" role="tab" aria-selected={active?.id === doc.id} title={doc.path || doc.name}
          onClick={() => onSelect(doc.id)} onAuxClick={event => { if (event.button === 1) onClose(doc.id) }}>
          <FileText size={14} /><span>{doc.name}</span>{isDirty(doc) && <i title="有未保存的改动" />}
        </button>
        <button type="button" className="tab-close" title="关闭标签" aria-label={'关闭 ' + doc.name} onClick={() => onClose(doc.id)}><X size={14}/></button>
      </div>)}
    </div>
    <IconButton icon={Plus} label="新建文档" onClick={onNew} />
  </div>
}

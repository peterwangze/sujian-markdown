import { useMemo, useState } from 'react'
import { Modal } from '../ui/Controls.jsx'
import { inspectSpecs, relativeSourcePath, workflowTemplates } from './workflows.js'

export function TemplatesDialog({ onCreate, onClose }) {
  return <Modal title="从模板创建文档" onClose={onClose}>
    {workflowTemplates.map((template, index) => <section key={template.name}>
      <div className="setting">
        <span><strong>{template.name}</strong></span>
        <button className="small-button" onClick={() => onCreate(index)}>创建{template.name}</button>
      </div>
      <p className="modal-detail">{template.description}</p>
    </section>)}
  </Modal>
}

export function SpecCheckDialog({ documents, onJump, onClose }) {
  const result = useMemo(() => inspectSpecs(documents), [documents])
  return <Modal title="检查规格与验收" onClose={onClose}>
    {result.count ? <p className="modal-detail">
      已在打开的文档中检查 {result.count} 个编号，发现 {result.issues.length} 项待核对。证据内容需人工确认。
    </p> : <p className="modal-detail">打开含 REQ-001 或 TASK-001 等章节编号的文档开始检查。</p>}
    <div className="search-results">
      {result.issues.map(({ docId, name, line, message }, index) => <button type="button" key={index}
        onClick={() => onJump(docId, line)}>
        <span>{message}<small>{name} · 第 {line} 行</small></span>
      </button>)}
    </div>
  </Modal>
}

export function SourceLinkDialog({ document, documents, onInsert, onClose }) {
  const choices = useMemo(() => documents.flatMap(doc => {
    if (doc.id === document.id || doc.text !== doc.savedText) return []
    const path = relativeSourcePath(document.path, doc.path)
    return path ? [{ ...doc, relativePath: path }] : []
  }), [document.id, document.path, documents])
  const [sourceId, setSourceId] = useState(() => choices[0]?.id ?? '')
  const [line, setLine] = useState('1')
  const [label, setLabel] = useState('')
  const source = choices.find(item => item.id === sourceId)
  const lineCount = source?.text.split(/\r\n|\n|\r/).length ?? 0
  const number = Number(line)
  const valid = Number.isInteger(number) && number >= 1 && number <= lineCount
  return <Modal title="插入来源链接" onClose={onClose}>
    {choices.length ? <form onSubmit={event => {
      event.preventDefault()
      if (!source || !valid) return
      onInsert({ href: source.relativePath + '#L' + number, label: label.trim() || source.name + ' · 第 ' + number + ' 行' })
    }}>
      <label className="text-setting">来源文档
        <select value={sourceId} onChange={event => { setSourceId(event.target.value); setLine('1') }}>
          {choices.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="setting"><span>来源行号</span>
        <input type="number" min="1" max={lineCount} value={line} required onChange={event => setLine(event.target.value)}/>
      </label>
      <label className="text-setting">链接文字
        <input value={label} onChange={event => setLabel(event.target.value)} placeholder={source?.name}/>
      </label>
      <footer><button type="button" onClick={onClose}>取消</button>
        <button className="primary" type="submit" disabled={!source || !valid}>插入来源</button>
      </footer>
    </form> : <p className="modal-detail">先在另一个标签页打开同一磁盘上的来源文档，并保存它的改动。</p>}
  </Modal>
}

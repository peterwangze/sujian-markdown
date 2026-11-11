import { useEffect, useMemo, useRef, useState } from 'react'
import { FileUp, GitBranch } from 'lucide-react'
import { renderPreview } from '../editor/render-document.js'
import { Modal } from '../ui/Controls.jsx'
import { MAX_LIVE_LENGTH } from '../workspace/text.js'
import { applyReview, buildReview } from './model.js'
import './review.css'

const changesPerPage = 24
const sourceLabels = { base: '底稿', current: '当前稿', candidate: '修订稿' }

function normalizeCandidate(candidate) {
  return candidate && { ...candidate, text: candidate.text.replace(/\r\n|\r/g, '\n') }
}

async function readLocalCandidate(file) {
  if (file.size > 4 * 1024 * 1024) throw new Error('修订稿审阅支持最大 4 MiB 的文档。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let encoding = 'utf-8'
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be'
  try {
    return { name: file.name, text: new TextDecoder(encoding, { fatal: true }).decode(bytes) }
  } catch {
    throw new Error('无法读取修订稿。请选择 UTF-8 或带 BOM 的 UTF-16 文本。')
  }
}

function SourcePane({ title, text, kind = '' }) {
  return <div className={'review-source ' + kind}>
    <h4>{title}</h4>
    {text === '' ? <p className="review-empty-source">空白</p> : <pre tabIndex={0} aria-label={title}>{text}</pre>}
  </div>
}

function ChangeCard({ change, comparison, decision, decide, disabled }) {
  const conflict = change.status === 'conflict'
  const ready = change.status === 'ready'
  const status = conflict ? '内容冲突' : change.status === 'already-applied' ? '已在当前稿中' :
    decision === 'accept' ? '已采纳' : decision === 'skip' ? '已跳过' : ''
  return <li className={'review-change' + (conflict ? ' is-conflict' : '')}>
    <div className="review-change-heading">
      <h3>第 {change.line} 行</h3>
      {status && <span className="review-status">{status}</span>}
      {!comparison && ready && <div className="review-decisions" aria-label={'第 ' + change.line + ' 行的处理方式'}>
        <button type="button" disabled={disabled} aria-pressed={decision === 'accept'} onClick={() => decide(change.id, 'accept')}>采纳此处</button>
        <button type="button" disabled={disabled} aria-pressed={decision === 'skip'} onClick={() => decide(change.id, 'skip')}>跳过此处</button>
      </div>}
    </div>
    <div className="review-source-grid">
      <SourcePane title={comparison ? 'Git 基线' : ready ? sourceLabels.current : sourceLabels.base} text={change.before} kind="is-before"/>
      {conflict && <SourcePane title={sourceLabels.current} text={change.current}/>}
      <SourcePane title={comparison ? sourceLabels.current : sourceLabels.candidate} text={change.after} kind="is-after"/>
    </div>
  </li>
}

function RenderedPane({ title, text, theme }) {
  const container = useRef(null)
  const [status, setStatus] = useState('loading')
  const tooLong = text.length > MAX_LIVE_LENGTH

  useEffect(() => {
    if (tooLong || !text.length) return
    const target = container.current
    let active = true
    target.replaceChildren()
    setStatus('loading')
    renderPreview(text, { theme, embeddedMediaOnly: true }).then(article => {
      if (!active) return
      for (const input of article.querySelectorAll('input, button')) input.disabled = true
      target.replaceChildren(article)
      setStatus('ready')
    }).catch(() => {
      if (active) setStatus('error')
    })
    return () => { active = false }
  }, [text, theme, tooLong])

  return <section className="review-rendered-pane" aria-label={title}>
    <h3>{title}</h3>
    {tooLong ? <p>文档较长，可在源码差异中审阅。</p> : text === '' ? <p>空白文档</p> : <>
      {status === 'loading' && <p role="status">正在渲染…</p>}
      {status === 'error' && <p role="alert">排版预览失败，可切换到源码差异。</p>}
      <div className="review-rendered-content" ref={container} />
    </>}
  </section>
}

export function ReviewDialog({ name, baseText, currentText, diskText, diskConflict, initialCandidate,
  compareGit, chooseCandidate, copyBase, theme, onApply, onClose }) {
  const [draft, setDraft] = useState('')
  const [candidate, setCandidate] = useState(() => normalizeCandidate(initialCandidate ?? null))
  const [importedBase, setImportedBase] = useState(null)
  const [copied, setCopied] = useState(false)
  const [gitBase, setGitBase] = useState(null)
  const [gitRef, setGitRef] = useState('HEAD')
  const [mode, setMode] = useState('candidate')
  const [view, setView] = useState('source')
  const [previewAccepted, setPreviewAccepted] = useState(false)
  const [decisions, setDecisions] = useState({})
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const fileInput = useRef(null)
  const filePurpose = useRef('candidate')
  const changesList = useRef(null)
  const comparing = mode === 'git'
  const left = comparing ? gitBase?.text : importedBase?.text ?? baseText
  const right = comparing ? currentText : candidate?.text
  const compared = useMemo(() => {
    if (left === undefined || right === undefined) return {}
    try {
      return { review: buildReview(left, comparing ? left : currentText, right) }
    } catch (error) {
      return { error: error.message }
    }
  }, [left, right, comparing, currentText])
  const changes = compared.review?.changes ?? []
  const ready = changes.filter(change => change.status === 'ready')
  const selected = ready.filter(change => decisions[change.id] === 'accept').map(change => change.id)
  const skipped = ready.filter(change => decisions[change.id] === 'skip').length
  const conflicts = changes.filter(change => change.status === 'conflict').length
  const pages = Math.ceil(changes.length / changesPerPage)
  const currentPage = Math.min(page, Math.max(0, pages - 1))

  function resetComparison() {
    setDecisions({})
    setPage(0)
    setView('source')
    setPreviewAccepted(false)
  }

  function stageCandidate(next) {
    setCandidate(normalizeCandidate(next))
    resetComparison()
  }

  function stageFile(file, purpose) {
    if (purpose === 'baseline') {
      setImportedBase(normalizeCandidate(file))
      setCopied(false)
      resetComparison()
    } else {
      stageCandidate(file)
    }
  }

  async function run(action) {
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (error) {
      setMessage(error.message || String(error))
    } finally {
      setBusy(false)
    }
  }

  function loadFile(purpose) {
    if (!chooseCandidate) {
      filePurpose.current = purpose
      fileInput.current?.click()
      return
    }
    void run(async () => {
      const next = await chooseCandidate(purpose)
      if (next) stageFile(next, purpose)
    })
  }

  function selectFile(event) {
    const file = event.currentTarget.files[0]
    event.currentTarget.value = ''
    const purpose = filePurpose.current
    if (file) void run(async () => stageFile(await readLocalCandidate(file), purpose))
  }

  function loadGit(event) {
    event.preventDefault()
    void run(async () => {
      setGitBase(null)
      const next = await compareGit(gitRef.trim())
      if (!next) throw new Error('找不到这个 Git 版本的文档。')
      setGitBase(next)
      setPage(0)
      setView('source')
    })
  }

  function changeMode(next) {
    setMode(next)
    setPage(0)
    setMessage('')
    setView('source')
  }

  function editCandidate() {
    setDraft(candidate.text)
    setMessage('')
    stageCandidate(null)
  }

  function decide(id, next) {
    setDecisions(previous => ({ ...previous, [id]: previous[id] === next ? undefined : next }))
  }

  function decideAll(next) {
    setDecisions(Object.fromEntries(ready.map(change => [change.id, next])))
  }

  function turnPage(next) {
    setPage(next)
    changesList.current?.scrollTo({ top: 0 })
  }

  function apply() {
    if (diskConflict || comparing || !selected.length) return
    void run(async () => {
      const text = applyReview(compared.review, selected)
      if (!await onApply({ expectedText: currentText, text })) {
        throw new Error('当前稿已改变，请重新核对差异后再应用。')
      }
    })
  }

  const close = () => { if (!busy) onClose() }
  const showComparison = comparing ? !!gitBase : !!candidate
  const renderedText = view === 'rendered' && !comparing && previewAccepted && compared.review ? applyReview(compared.review, selected) : right

  return <Modal title="审阅修订稿" onClose={close} className="review-modal">
    <div className="review-context">
      <p className="review-document" title={name}>{name}</p>
      {compareGit && <div className="review-toggle" role="group" aria-label="审阅来源">
        <button type="button" aria-pressed={!comparing} disabled={busy} onClick={() => changeMode('candidate')}>修订稿</button>
        <button type="button" aria-pressed={comparing} disabled={busy} onClick={() => changeMode('git')}><GitBranch size={14}/>Git 比较</button>
      </div>}
    </div>
    {diskConflict && !comparing && <details className="review-disk-conflict">
      <summary>磁盘文件已改变。请先处理磁盘冲突，再应用修订。</summary>
      <div className="review-source-grid">
        <SourcePane title={sourceLabels.base} text={left}/>
        <SourcePane title={sourceLabels.current} text={currentText}/>
        {typeof diskText === 'string' ? <SourcePane title="磁盘稿" text={diskText}/> : <p>磁盘文件已移除。</p>}
      </div>
    </details>}
    {!comparing && <div className="review-baseline">
      <span className="review-origin">底稿 · {importedBase?.name ?? '打开审阅时的文档'}</span>
      {copyBase && <button type="button" className="small-button" disabled={busy} onClick={() => void run(async () => {
        await copyBase(left)
        setCopied(true)
      })}>{copied ? '底稿已复制' : '复制底稿'}</button>}
      <button type="button" className="small-button" disabled={busy} onClick={() => loadFile('baseline')}>选择旧底稿</button>
      {importedBase && <button type="button" className="small-button" disabled={busy}
        onClick={() => stageFile(null, 'baseline')}>恢复默认底稿</button>}
    </div>}
    {comparing ? <form className="review-git" onSubmit={loadGit}>
      <label htmlFor="review-git-ref">Git 版本</label>
      <input id="review-git-ref" value={gitRef} onChange={event => setGitRef(event.target.value)} disabled={busy} spellCheck="false"/>
      <button className="small-button" type="submit" disabled={busy || !gitRef.trim()}>比较 Git 版本</button>
      {gitBase && <span className="review-origin" title={gitBase.name}>{gitBase.name}</span>}
    </form> : candidate ? <div className="review-origin-row">
      <span className="review-origin" title={candidate.name}>{candidate.name}</span>
      <button className="small-button" type="button" onClick={editCandidate} disabled={busy}>更换修订稿</button>
    </div> : <div className="review-input">
      <label htmlFor="review-candidate">粘贴完整的 Markdown 修订稿</label>
      <textarea id="review-candidate" value={draft} onChange={event => setDraft(event.target.value)} disabled={busy} spellCheck="false" autoFocus/>
      <div className="review-input-actions">
        <button className="small-button" type="button" onClick={() => loadFile('candidate')} disabled={busy}><FileUp size={15}/>选择修订文件</button>
        <button className="primary" type="button" disabled={busy || draft === ''} onClick={() => stageCandidate({ name: '粘贴的修订稿', text: draft })}>比较修订稿</button>
      </div>
    </div>}
    {!chooseCandidate && <input ref={fileInput} type="file" accept=".md,.markdown,.mdown,.mkd,.txt,.qmd" onChange={selectFile} hidden/>}
    {showComparison && <>
      <div className="review-options">
        <div className="review-toggle" role="group" aria-label="差异视图">
          <button type="button" aria-pressed={view === 'source'} onClick={() => setView('source')}>源码差异</button>
          <button type="button" aria-pressed={view === 'rendered'} onClick={() => setView('rendered')}>排版预览</button>
        </div>
        {!comparing && view === 'source' && ready.length > 0 && <div className="review-bulk">
          <button type="button" disabled={busy} onClick={() => decideAll('accept')}>采纳所有可用改动</button>
          <button type="button" disabled={busy} onClick={() => decideAll('skip')}>全部跳过</button>
        </div>}
        {!comparing && view === 'rendered' && compared.review && <label className="review-preview-choice">
          <input type="checkbox" checked={previewAccepted} onChange={event => setPreviewAccepted(event.target.checked)}/>只预览已采纳的改动
        </label>}
      </div>
      {compared.error ? <p className="review-error" role="alert">{compared.error}</p> : view === 'rendered' ? <div className="review-preview-grid">
        <RenderedPane title={comparing ? 'Git 基线' : sourceLabels.current} text={comparing ? left : currentText} theme={theme}/>
        <RenderedPane title={comparing ? sourceLabels.current : previewAccepted ? '采纳后的文档' : sourceLabels.candidate} text={renderedText} theme={theme}/>
      </div> : changes.length === 0 ? <p className="review-notice">两份文档没有差异。</p> : <>
        <ol ref={changesList} className="review-changes" aria-label="文档改动">
          {changes.slice(currentPage * changesPerPage, (currentPage + 1) * changesPerPage).map(change =>
            <ChangeCard key={change.id} change={change} comparison={comparing} decision={decisions[change.id]} decide={decide} disabled={busy}/>)}
        </ol>
        {pages > 1 && <nav className="review-pager" aria-label="差异分页">
          <button type="button" disabled={currentPage === 0} onClick={() => turnPage(currentPage - 1)}>上一页</button>
          <span>{currentPage + 1} / {pages}</span>
          <button type="button" disabled={currentPage === pages - 1} onClick={() => turnPage(currentPage + 1)}>下一页</button>
        </nav>}
      </>}
    </>}
    {message && <p className="review-error" role="alert">{message}</p>}
    <footer className="review-footer">
      {compared.review && <p role="status">
        {comparing ? `${changes.length} 处差异` : `已采纳 ${selected.length} · 已跳过 ${skipped}${conflicts ? ` · ${conflicts} 处冲突` : ''}`}
      </p>}
      {busy && <span role="status">处理中…</span>}
      <button type="button" onClick={close} disabled={busy}>结束审阅</button>
      {!comparing && !!candidate && <button type="button" className="primary" onClick={apply}
        disabled={busy || diskConflict || !selected.length}>应用已采纳改动</button>}
    </footer>
  </Modal>
}

export default ReviewDialog

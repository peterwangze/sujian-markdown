import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FileUp, GitBranch } from 'lucide-react'
import { renderPreview } from '../editor/render-document.js'
import { Modal } from '../ui/Controls.jsx'
import { MAX_LIVE_LENGTH } from '../workspace/text.js'
import { applyReview, buildReview, selectionOverwritesUnsavedChanges } from './model.js'
import { buildInlineDiff } from './inline-diff.js'
import { markRenderedDiff } from './rendered-diff.js'
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

function InlineSource({ parts, kind }) {
  const Change = kind === 'is-before' ? 'del' : 'ins'
  return parts.map(({ text, changed }, index) => changed ? <Change key={index} className="review-inline-change">
    {text.trim() === '' && /[\r\n]/.test(text) && <span className="review-line-break" aria-hidden="true" title="换行变化"/>}
    {text}
  </Change> : text)
}

function SourcePane({ title, text, parts, kind = '' }) {
  return <div className={'review-source ' + kind}>
    <h4>{title}</h4>
    {text === '' ? <p className="review-empty-source">空白</p> : <pre tabIndex={0} aria-label={title} className={parts ? 'has-inline-diff' : undefined}>
      {parts ? <InlineSource parts={parts} kind={kind}/> : text}
    </pre>}
  </div>
}

function ChangeCard({ change, comparison, restoration, decision, decide, disabled }) {
  const conflict = change.status === 'conflict'
  const ready = change.status === 'ready'
  const status = conflict ? '内容冲突' : change.status === 'already-applied' ? '已在当前稿中' :
    decision === 'accept' ? '已采纳' : decision === 'skip' ? '已跳过' : ''
  const leftTitle = comparison ? 'Git 基线' : ready ? sourceLabels.current : sourceLabels.base
  const rightTitle = comparison ? sourceLabels.current : sourceLabels.candidate
  const leftText = restoration ? change.after : change.before
  const rightText = restoration ? change.before : change.after
  const inline = useMemo(() => comparison ? buildInlineDiff(leftText, rightText) : null, [comparison, leftText, rightText])
  return <li className={'review-change' + (conflict ? ' is-conflict' : '')}>
    <div className="review-change-heading">
      <h3>第 {change.line} 行</h3>
      {status && <span className="review-status">{status}</span>}
      {!comparison && ready && <div className="review-decisions" aria-label={'第 ' + change.line + ' 行的处理方式'}>
        <button type="button" disabled={disabled} aria-pressed={decision === 'accept'} onClick={() => decide(change.id, 'accept')}>采纳此处</button>
        <button type="button" disabled={disabled} aria-pressed={decision === 'skip'} onClick={() => decide(change.id, 'skip')}>跳过此处</button>
      </div>}
      {restoration && <label className="review-choice review-restore-choice">
        <input type="checkbox" aria-label={`恢复第 ${change.line} 行的改动`} checked={restoration.checked}
          onChange={event => restoration.choose(change.id, event.target.checked)} disabled={disabled}/>
        恢复此处
      </label>}
    </div>
    <div className="review-source-grid">
      <SourcePane title={leftTitle} text={leftText} parts={inline?.before} kind="is-before"/>
      {conflict && <SourcePane title={sourceLabels.current} text={change.current}/>}
      <SourcePane title={rightTitle} text={rightText} parts={inline?.after} kind="is-after"/>
    </div>
  </li>
}

async function renderReviewArticle(text, theme) {
  if (text.length > MAX_LIVE_LENGTH) return null
  if (text === '') return document.createElement('article')
  const article = await renderPreview(text, { theme, embeddedMediaOnly: true })
  for (const input of article.querySelectorAll('input, button')) input.disabled = true
  return article
}

function RenderedPane({ title, text, result, side }) {
  const container = useRef(null)
  useLayoutEffect(() => {
    const target = container.current
    if (!target || !result?.value) return
    target.replaceChildren(result.value)
    return () => target.replaceChildren()
  }, [result])

  return <section className={'review-rendered-pane ' + side} aria-label={title}>
    <h3>{title}</h3>
    {text.length > MAX_LIVE_LENGTH ? <p>文档较长，可在源码差异中审阅。</p> : text === '' ? <p>空白文档</p> : <>
      {!result && <p role="status">正在渲染…</p>}
      {result?.status === 'rejected' && <p role="alert">排版预览失败，可切换到源码差异。</p>}
      <div className="review-rendered-content" ref={container} />
    </>}
  </section>
}

function RenderedComparison({ leftTitle, rightTitle, beforeText, afterText, theme, highlight }) {
  const baseline = useRef(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let active = true
    if (baseline.current?.text !== beforeText || baseline.current?.theme !== theme) {
      baseline.current = { text: beforeText, theme, article: renderReviewArticle(beforeText, theme) }
    }
    Promise.allSettled([baseline.current.article, renderReviewArticle(afterText, theme)]).then(([before, after]) => {
      if (!active) return
      let note = ''
      if (highlight && before.value && after.value && beforeText !== afterText) {
        const markedBefore = before.value.cloneNode(true)
        const markedAfter = after.value.cloneNode(true)
        try {
          if (markRenderedDiff(markedBefore, markedAfter)) {
            before = { ...before, value: markedBefore }
            after = { ...after, value: markedAfter }
            if (!markedBefore.querySelector('.review-rendered-change') && !markedAfter.querySelector('.review-rendered-change')) {
              note = '两栏没有可定位的文字差异。可在源码差异中核对 Markdown 标记、链接地址等变化。'
            }
          } else {
            note = '排版差异较多，可在源码差异中核对改动。'
          }
        } catch {
          note = '行内标记暂不可用，可在源码差异中核对改动。'
        }
      }
      setResult({ beforeText, afterText, theme, highlight, before, after, note })
    })
    return () => { active = false }
  }, [beforeText, afterText, theme, highlight])

  const current = result?.beforeText === beforeText && result.afterText === afterText && result.theme === theme && result.highlight === highlight ? result : null
  return <>
    {current?.note && <p className="review-rendered-note" role="status">{current.note}</p>}
    <div className="review-preview-grid">
      <RenderedPane title={leftTitle} text={beforeText} result={current?.before} side="is-before"/>
      <RenderedPane title={rightTitle} text={afterText} result={current?.after} side="is-after"/>
    </div>
  </>
}

export function ReviewDialog({ name, baseText, currentText, savedText = currentText, diskText, diskConflict, initialCandidate, initialGitBase,
  compareGit, chooseCandidate, copyBase, theme, onApply, onClose, onGitHistory }) {
  const [draft, setDraft] = useState('')
  const [candidate, setCandidate] = useState(() => normalizeCandidate(initialCandidate ?? null))
  const [importedBase, setImportedBase] = useState(null)
  const [copied, setCopied] = useState(false)
  const [gitBase, setGitBase] = useState(initialGitBase ?? null)
  const [gitRef, setGitRef] = useState('HEAD')
  const [mode, setMode] = useState(initialGitBase ? 'git' : 'candidate')
  const [view, setView] = useState('source')
  const [previewAccepted, setPreviewAccepted] = useState(false)
  const [decisions, setDecisions] = useState({})
  const [restoreChoices, setRestoreChoices] = useState(null)
  const [restoreConfirmation, setRestoreConfirmation] = useState(null)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const fileInput = useRef(null)
  const filePurpose = useRef('candidate')
  const changesList = useRef(null)
  const cancelRestore = useRef(null)
  const comparing = mode === 'git'
  const restoring = comparing && Boolean(onGitHistory)
  const currentDirty = currentText !== savedText
  const left = comparing ? gitBase?.text : importedBase?.text ?? baseText
  const right = comparing ? currentText : candidate?.text
  const compared = useMemo(() => {
    if (left === undefined || right === undefined) return {}
    try {
      const review = restoring ? buildReview(currentText, currentText, left) : buildReview(left, comparing ? left : currentText, right)
      return { review }
    } catch (error) {
      return { error: error.message }
    }
  }, [left, right, comparing, restoring, currentText])
  const changes = compared.review?.changes ?? []
  const ready = changes.filter(change => change.status === 'ready')
  const selected = ready.filter(change => decisions[change.id] === 'accept').map(change => change.id)
  const selectedRestores = restoreChoices?.review === compared.review ? restoreChoices?.ids ?? [] : []
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
    setPreviewAccepted(false)
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

  function chooseRestore(id, checked) {
    setRestoreChoices(previous => {
      const ids = previous?.review === compared.review ? previous.ids : []
      return { review: compared.review, ids: checked ? [...ids, id] : ids.filter(change => change !== id) }
    })
  }

  function turnPage(next) {
    setPage(next)
    changesList.current?.scrollTo({ top: 0 })
  }

  function apply(expectedText, entireDocument = false) {
    const selectedIds = restoring ? selectedRestores : selected
    if (diskConflict || currentText !== expectedText || (comparing && !restoring) || (!entireDocument && !selectedIds.length)) return
    void run(async () => {
      const text = entireDocument ? gitBase.text : applyReview(compared.review, selectedIds)
      if (!await onApply({ expectedText, text, restoringHistory: restoring })) {
        throw new Error('当前稿已改变，请重新核对差异后再应用。')
      }
    })
  }

  function requestRestore(entireDocument) {
    if (entireDocument || selectionOverwritesUnsavedChanges(compared.review, savedText, selectedRestores)) {
      setMessage('')
      setRestoreConfirmation({ text: currentText, entireDocument, wasDirty: currentDirty })
    } else apply(currentText)
  }

  const close = () => { if (!busy) onClose() }
  const closeRestoreConfirmation = () => {
    if (busy) return
    setRestoreConfirmation(null)
    setMessage('')
  }
  const showComparison = comparing ? !!gitBase : !!candidate
  const previewSelection = (!comparing || restoring) && previewAccepted && compared.review
  const renderedText = view === 'rendered' && previewSelection ? applyReview(compared.review, restoring ? selectedRestores : selected) : right
  const renderedRightTitle = restoring && previewSelection ? '恢复后的文档' : comparing ? sourceLabels.current :
    previewAccepted ? '采纳后的文档' : sourceLabels.candidate
  const canRestoreAll = restoring && gitBase && gitBase.text !== currentText && !diskConflict
  const confirmationStale = restoreConfirmation && restoreConfirmation.text !== currentText

  return <><Modal title="审阅修订稿" onClose={close} className="review-modal">
    <div className="review-context">
      <p className="review-document" title={name}>{name}</p>
      {compareGit && <div className="review-toggle" role="group" aria-label="审阅来源">
        <button type="button" aria-pressed={!comparing} disabled={busy} onClick={() => changeMode('candidate')}>修订稿</button>
        <button type="button" aria-pressed={comparing} disabled={busy} onClick={() => changeMode('git')}><GitBranch size={14}/>Git 比较</button>
      </div>}
    </div>
    {diskConflict && (!comparing || restoring) && <details className="review-disk-conflict">
      <summary>磁盘文件已改变。{restoring ? '请先处理磁盘冲突，再恢复历史内容。' : '请先处理磁盘冲突，再应用修订。'}</summary>
      <div className="review-source-grid">
        <SourcePane title={restoring ? 'Git 基线' : sourceLabels.base} text={left}/>
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
    {comparing ? onGitHistory ? <div className="review-git">
      {gitBase && <span className="review-origin" title={gitBase.name}>{gitBase.name}</span>}
    </div> : <form className="review-git" onSubmit={loadGit}>
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
        {comparing && left !== (view === 'rendered' ? renderedText : right) && <div className="review-diff-key" role="group" aria-label="差异标记">
          <span className="is-before"><del className="review-inline-change">基线删改</del></span>
          <span className="is-after"><ins className="review-inline-change">{previewSelection ? '预览新增' : '当前新增'}</ins></span>
        </div>}
        {!comparing && view === 'source' && ready.length > 0 && <div className="review-bulk">
          <button type="button" disabled={busy} onClick={() => decideAll('accept')}>采纳所有可用改动</button>
          <button type="button" disabled={busy} onClick={() => decideAll('skip')}>全部跳过</button>
        </div>}
        {(!comparing || restoring) && view === 'rendered' && compared.review && <label className="review-choice">
          <input type="checkbox" checked={previewAccepted} onChange={event => setPreviewAccepted(event.target.checked)}/>
          {restoring ? '只预览选中的恢复' : '只预览已采纳的改动'}
        </label>}
      </div>
      {view === 'rendered' && (comparing || !compared.error) ? <RenderedComparison
        leftTitle={comparing ? 'Git 基线' : sourceLabels.current} rightTitle={renderedRightTitle}
        beforeText={comparing ? left : currentText} afterText={renderedText} theme={theme} highlight={comparing}/>
      : compared.error ? <p className="review-error" role="alert">{compared.error}</p> : changes.length === 0 ? <p className="review-notice">两份文档没有差异。</p> : <>
        <ol ref={changesList} className="review-changes" aria-label="文档改动">
          {changes.slice(currentPage * changesPerPage, (currentPage + 1) * changesPerPage).map(change =>
            <ChangeCard key={change.id} change={change} comparison={comparing} decision={decisions[change.id]} decide={decide}
              restoration={restoring ? { checked: selectedRestores.includes(change.id), choose: chooseRestore } : null}
              disabled={busy || (restoring && diskConflict)}/>)}
        </ol>
        {pages > 1 && <nav className="review-pager" aria-label="差异分页">
          <button type="button" disabled={currentPage === 0} onClick={() => turnPage(currentPage - 1)}>上一页</button>
          <span>{currentPage + 1} / {pages}</span>
          <button type="button" disabled={currentPage === pages - 1} onClick={() => turnPage(currentPage + 1)}>下一页</button>
        </nav>}
      </>}
    </>}
    {message && !restoreConfirmation && <p className="review-error" role="alert">{message}</p>}
    <footer className="review-footer">
      {compared.review && <p role="status">
        {restoring ? `已选 ${selectedRestores.length} 处 · 共 ${changes.length} 处差异` : comparing ? `${changes.length} 处差异` :
          `已采纳 ${selected.length} · 已跳过 ${skipped}${conflicts ? ` · ${conflicts} 处冲突` : ''}`}
      </p>}
      {busy && <span role="status">处理中…</span>}
      {onGitHistory && <button type="button" onClick={onGitHistory} disabled={busy}>返回提交历史</button>}
      <button type="button" onClick={close} disabled={busy}>结束审阅</button>
      {!comparing && !!candidate && <button type="button" className="primary" onClick={() => apply(currentText)}
        disabled={busy || diskConflict || !selected.length}>应用已采纳改动</button>}
      {restoring && <>
        <button type="button" onClick={() => requestRestore(true)}
          disabled={busy || !canRestoreAll}>恢复整篇…</button>
        <button type="button" className="primary" onClick={() => requestRestore(false)}
          disabled={busy || diskConflict || !selectedRestores.length}>恢复所选改动</button>
      </>}
    </footer>
  </Modal>
  {restoreConfirmation && <Modal title={restoreConfirmation.entireDocument ? '恢复整个历史版本？' : '恢复所选改动？'}
    onClose={closeRestoreConfirmation} initialFocusRef={cancelRestore}>
    {restoreConfirmation.entireDocument && <p className="modal-detail">将用「{gitBase.name}」的全文替换「{name}」的当前稿。</p>}
    {(restoreConfirmation.wasDirty || currentDirty) && <p role="alert">{restoreConfirmation.entireDocument
      ? '当前稿有未保存的修改，整篇恢复会覆盖这些修改。' : '所选改动包含未保存的修改，恢复会覆盖这些修改。'}</p>}
    <p className="modal-detail">可在文档右键菜单选择「撤销本次审阅」，找回恢复前的稿件。</p>
    {(confirmationStale || diskConflict || message) && <p className="review-error" role="alert">
      {confirmationStale ? '当前稿已改变。请取消并重新核对差异。' : diskConflict ? '磁盘文件已改变。请先处理磁盘冲突。' : message}
    </p>}
    <footer>
      <button type="button" ref={cancelRestore} onClick={closeRestoreConfirmation} disabled={busy}>取消</button>
      <button type="button" className="danger" disabled={busy || confirmationStale || diskConflict}
        onClick={() => apply(restoreConfirmation.text, restoreConfirmation.entireDocument)}>
        {restoreConfirmation.entireDocument ? '确认恢复整篇' : '确认恢复所选改动'}
      </button>
    </footer>
  </Modal>}</>
}

export default ReviewDialog

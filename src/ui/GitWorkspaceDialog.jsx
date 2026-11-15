import { useEffect, useRef, useState } from 'react'
import { GitBranch } from 'lucide-react'
import { Modal } from './Controls.jsx'
import './git-workspace-dialog.css'

const changeNames = { A: '新增', M: '修改', D: '删除', R: '重命名', C: '复制', T: '类型变化', U: '冲突', '?': '未跟踪' }

function changeLabel(status) {
  if (status === '??') return '新增'
  return [...new Set(String(status).split('').map(letter => changeNames[letter]).filter(Boolean))].join('、') || '变更'
}

export function GitWorkspaceDialog({ directory, workspacePath, inspect, initialize, commit, unsaved,
  saveDocuments, openWorkspace, compareCurrent, onClose }) {
  const [status, setStatus] = useState(null)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const mounted = useRef(false)

  function updateStatus(next) {
    setStatus(next)
    setMessage(previous => previous || (next.head ? '更新工作区文档' : '建立文档基线'))
  }

  useEffect(() => {
    mounted.current = true
    let alive = true
    inspect(directory).then(next => {
      if (alive) updateStatus(next)
    }).catch(error => {
      if (alive) setError(error.message || String(error))
    }).finally(() => {
      if (alive) setBusy(false)
    })
    return () => { alive = false; mounted.current = false }
  }, [directory, inspect])

  async function run(work) {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (failure) {
      if (mounted.current) setError(failure.message || String(failure))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  async function refresh() {
    updateStatus(await inspect(directory))
  }

  function initializeRepository() {
    void run(async () => updateStatus(await initialize(directory)))
  }

  function saveAndRefresh() {
    void run(async () => {
      await saveDocuments(status.root)
      await refresh()
    })
  }

  function commitChanges(event) {
    event.preventDefault()
    if (!canCommit) return
    void run(async () => {
      try {
        const next = await commit({ directory: status.root, message: message.trim(), expectedSnapshot: status.snapshot })
        if (next.status === 'changed') {
          updateStatus(next.workspace)
          setError('待提交的文件有变动。请核对刷新后的清单，再提交。')
          return
        }
        if (next.status === 'committed') {
          setResult(next)
          setMessage('更新工作区文档')
        }
        await refresh()
      } catch (failure) {
        await refresh().catch(() => {})
        throw failure
      }
    })
  }

  const close = () => { if (!busy) onClose() }
  const repository = status?.scope === 'root'
  const changes = status?.changes ?? []
  const pendingFiles = repository ? unsaved(status.root) : []
  const canCommit = repository && !busy && changes.length > 0 && status.hasIdentity && !status.blocked && !pendingFiles.length && Boolean(message.trim())

  return <Modal title="Git 版本管理" onClose={close} className="git-workspace-modal">
    <p className="modal-detail git-workspace-path" title={directory}>{directory}</p>
    {busy && <p role="status" className="modal-detail">正在处理 Git 操作…</p>}
    {error && <p role="alert" className="git-workspace-error">{error}</p>}
    {status?.available === false && <p>未找到 Git。安装 Git 并让素笺能从 PATH 找到它后，点击刷新。</p>}
    {status?.scope === 'none' && status.available && <p>在此目录创建本地 Git 仓库。初始化后即可提交第一版文档。</p>}
    {status?.scope === 'inside' && <>
      <p>此目录属于以下 Git 仓库。请到仓库根目录提交修改。</p>
      <p className="modal-detail git-workspace-path">{status.root}</p>
    </>}
    {repository && <>
      <p className="git-workspace-branch"><GitBranch size={16} aria-hidden="true"/>
        <strong>{status.branch || '分离的 HEAD'}</strong><span>{status.head ? status.head.slice(0, 8) : '尚无提交'}</span></p>
      {result && <p role="status">已提交 <code>{result.hash?.slice(0, 8)}</code></p>}
      {!status.hasIdentity && <p className="git-workspace-error">Git 作者身份尚未配置。设置 <code>user.name</code> 和 <code>user.email</code> 后点击刷新。</p>}
      {status.blocked && <p role="alert" className="git-workspace-error">{status.blocked}</p>}
      {pendingFiles.length > 0 && <div className="git-workspace-pending">
        <p>有 {pendingFiles.length} 份文档尚未保存。保存后刷新文件清单。</p>
        <ul>{pendingFiles.map(doc => <li key={doc.id}>{doc.name}{doc.conflict ? ' · 磁盘冲突' : ''}</li>)}</ul>
        <button type="button" disabled={busy || pendingFiles.some(doc => doc.conflict)} onClick={saveAndRefresh}>保存后刷新</button>
      </div>}
      <p>{changes.length ? `将提交此仓库的 ${changes.length} 项磁盘变更` : '工作区没有可提交的变更。'}</p>
      {changes.length > 0 && <ul className="git-workspace-changes" aria-label="待提交文件">
        {changes.map(({ path, status, previousPath }) => <li key={path}>
          <span>{changeLabel(status)}</span><code>{previousPath ? `${previousPath} → ${path}` : path}</code>
        </li>)}
      </ul>}
    </>}
    <form onSubmit={commitChanges}>
      {repository && changes.length > 0 && <label className="text-setting">提交说明
        <input value={message} onChange={event => setMessage(event.target.value)} maxLength={200} required disabled={busy}/>
      </label>}
      <footer className="git-workspace-actions">
        {(repository || status?.scope === 'inside') && status.root !== workspacePath &&
          <button type="button" disabled={busy} onClick={() => openWorkspace(status.root)}>打开为工作区</button>}
        {repository && status.head && compareCurrent &&
          <button type="button" disabled={busy} onClick={() => void run(() => compareCurrent(status.root))}>比较当前文档与 HEAD</button>}
        <button type="button" disabled={busy} onClick={() => void run(refresh)}>刷新</button>
        {status?.scope === 'none' && status.available &&
          <button type="button" className="primary" disabled={busy} onClick={initializeRepository}>初始化 Git 仓库</button>}
        {repository && changes.length > 0 && <button type="submit" className="primary" disabled={!canCommit}>暂存并提交</button>}
      </footer>
    </form>
  </Modal>
}

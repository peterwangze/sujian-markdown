import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight, GitCommitHorizontal } from 'lucide-react'
import { Modal } from '../ui/Controls.jsx'
import './git-document-history.css'

const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })

function commitTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '' : dateFormat.format(date)
}

export function GitDocumentHistory({ name, documentPath, initialPage, listHistory, readRevision, onCompare, onClose }) {
  const [page, setPage] = useState(initialPage ?? null)
  const [busy, setBusy] = useState(initialPage ? '' : 'history')
  const [error, setError] = useState('')
  const mounted = useRef(false)
  const list = useRef(null)

  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = initialPage?.scrollTop ?? 0
  }, [initialPage])

  useEffect(() => {
    mounted.current = true
    let active = true
    if (!initialPage) {
      listHistory({ documentPath }).then(history => {
        if (active) setPage(history)
      }).catch(failure => {
        if (active) setError(failure.message || String(failure))
      }).finally(() => {
        if (active) setBusy('')
      })
    }
    return () => { active = false; mounted.current = false }
  }, [documentPath, initialPage, listHistory])

  async function run(key, work) {
    setBusy(key)
    setError('')
    try {
      await work()
    } catch (failure) {
      if (mounted.current) setError(failure.message || String(failure))
    } finally {
      if (mounted.current) setBusy('')
    }
  }

  function load(cursor) {
    void run('history', async () => {
      const next = await listHistory({ documentPath, cursor })
      if (!mounted.current) return
      if (!cursor) return setPage(next)
      setPage({ ...next, entries: [...page.entries, ...next.entries] })
    })
  }

  function compare(entry) {
    const scrollTop = list.current?.scrollTop ?? 0
    void run(entry.commit, async () => {
      const baseline = await readRevision({ documentPath, commit: entry.commit })
      if (mounted.current) onCompare(baseline, { ...page, scrollTop })
    })
  }

  return <Modal title="Git 提交历史" onClose={onClose} className="git-history-modal">
    <p className="modal-detail git-history-document">{name}</p>
    {page?.status === 'not-repository' && <p>当前文档不在 Git 工作区中。</p>}
    {page?.status === 'empty' && <p>当前文档在此 Git 分支中还没有提交记录。</p>}
    {page?.entries.length > 0 && <>
      <p className="modal-detail">选择一项提交，与当前稿比较。</p>
      <ol ref={list} className="git-history-list" aria-label="文档提交">
        {page.entries.map(entry => <li key={entry.commit}>
          <button type="button" className="git-history-entry" disabled={Boolean(busy) || entry.available === false}
            onClick={() => compare(entry)}>
            <GitCommitHorizontal size={18} aria-hidden="true"/>
            <span className="git-history-description">
              <strong>{entry.subject || '无提交说明'}</strong>
              <span className="git-history-meta">{entry.author || '未知作者'}{commitTime(entry.date) && <> · <time dateTime={entry.date}>{commitTime(entry.date)}</time></>}</span>
              {entry.path && <span className="git-history-meta">{entry.path}</span>}
              {entry.available === false && <span className="git-history-meta">此提交没有可比较的文档版本</span>}
            </span>
            <code title={entry.commit}>{entry.commit.slice(0, 8)}</code>
            {entry.available !== false && <ChevronRight size={15} aria-hidden="true"/>}
          </button>
        </li>)}
      </ol>
    </>}
    {error && <p className="git-history-error" role="alert">{error}</p>}
    {busy && <p className="modal-detail" role="status">{busy === 'history' ? '正在读取提交历史…' : '正在读取选中的版本…'}</p>}
    <footer>
      {error && <button type="button" disabled={Boolean(busy)} onClick={() => load()}>{page ? '刷新历史' : '重试'}</button>}
      {page?.nextCursor && <button type="button" disabled={Boolean(busy)} onClick={() => load(page.nextCursor)}>加载更早提交</button>}
      <button type="button" onClick={onClose}>关闭历史</button>
    </footer>
  </Modal>
}

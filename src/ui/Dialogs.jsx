import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, X, Search, FileText, RotateCcw } from 'lucide-react'
import { desktop } from '../workspace/desktop.js'
import { formats, fuzzy } from '../workspace/text.js'
import { isComposingKey } from '../workspace/commands.js'
import { IconButton, Modal } from './Controls.jsx'
import { FontSettings, ThemeSettings } from './AppearanceSettings.jsx'
import { ShortcutSettings } from './ShortcutSettings.jsx'

export function FindBar({ initial, close, find, replace, controlRef }) {
  const [query, setQuery] = useState(initial.query ?? '')
  const [replacement, setReplacement] = useState('')
  const [showReplace, setShowReplace] = useState(initial.replace)
  const [flags, setFlags] = useState({ caseSensitive: false, wholeWord: false, regex: false })
  const [message, setMessage] = useState('')
  const input = useRef(null)
  useEffect(() => { input.current.focus(); input.current.select() }, [])
  useImperativeHandle(controlRef, () => ({
    open(replacing) {
      if (replacing) setShowReplace(true)
      input.current.focus({ preventScroll: true })
      input.current.select()
    },
    next: run,
  }))
  function run(backward = false) {
    try {
      const match = query && find(query, { ...flags, backward })
      setMessage(match ? match.index + ' / ' + match.count : '无匹配')
      input.current.focus({ preventScroll: true })
    } catch (error) { setMessage(error.message) }
  }
  function replaceMatches(all) {
    try {
      const count = query ? replace(query, replacement, { ...flags, all }) : 0
      setMessage('已替换 ' + count + ' 处')
    } catch (error) { setMessage(error.message) }
  }
  return <section className="find-bar" aria-label="查找和替换" onKeyDown={event => {
    if (event.key === 'Escape' && !isComposingKey(event.nativeEvent)) close()
  }}>
    <form onSubmit={event => { event.preventDefault(); run() }}>
      <Search size={17}/><input ref={input} aria-label="查找文字" placeholder="在本文档中查找" value={query}
        onKeyDown={event => {
          if (event.key !== 'Enter' || isComposingKey(event.nativeEvent)) return
          event.preventDefault()
          run(event.shiftKey)
        }}
        onChange={event => { setQuery(event.target.value); setMessage('') }}/>
      <span className="match-count" aria-live="polite">{message}</span>
      <IconButton icon={ArrowUp} label="上一个匹配" title="上一个匹配（Shift+F3）" onClick={() => run(true)}/>
      <IconButton icon={ArrowDown} label="下一个匹配" title="下一个匹配（F3）" onClick={() => run()}/>
      <button className="small-button" type="button" onClick={() => setShowReplace(!showReplace)}>替换</button>
      <IconButton icon={X} label="关闭查找" onClick={close}/>
    </form>
    <div className="find-options">
      {[['caseSensitive','区分大小写'], ['wholeWord','全词'], ['regex','正则表达式']].map(([key, label]) =>
        <label key={key}><input type="checkbox" checked={flags[key]} onChange={event => setFlags({ ...flags, [key]: event.target.checked })}/>{label}</label>)}
    </div>
    {showReplace && <form onSubmit={event => { event.preventDefault(); replaceMatches(false) }}>
      <input aria-label="替换为" placeholder="替换为…" value={replacement} onChange={event => setReplacement(event.target.value)}/>
      <button className="small-button" type="submit">替换一处</button>
      <button className="small-button" type="button" onClick={() => replaceMatches(true)}>全部替换</button>
    </form>}
  </section>
}

export function QuickOpen({ workspace, onClose, notify }) {
  const [files, setFiles] = useState([])
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listId = useId()
  const queryInput = useRef(null)
  const selectedResult = useRef(null)
  const { settings, docs, openPath, select } = workspace
  useEffect(() => {
    let current = true
    if (settings.workspace && desktop.findDocuments) desktop.findDocuments(settings.workspace, { showHidden: settings.showHidden, limit: 5000 }).then(result => {
      if (current) setFiles(Array.isArray(result) ? result : result.files ?? result.documents ?? [])
    }).catch(error => notify(error.message, true))
    return () => { current = false }
  }, [settings.workspace, settings.showHidden, notify])
  const candidates = useMemo(() => {
    const entries = [...docs, ...[...settings.recent, ...files].map(file => typeof file === 'string' ?
      { path: file, name: file.split(/[\\/]/).at(-1) } : file)]
    const unique = new Map()
    for (const item of entries) {
      const key = item.path || item.id
      if (!unique.has(key)) unique.set(key, item)
    }
    return [...unique.values()].map(item => ({ ...item, score: Math.max(fuzzy(item.name, query), fuzzy(item.path || '', query) - 10) }))
      .filter(item => item.score >= 0).sort((a, b) => b.score - a.score).slice(0, 50)
  }, [docs, settings.recent, files, query])
  const selected = Math.min(index, candidates.length - 1)
  useEffect(() => { selectedResult.current?.scrollIntoView({ block: 'nearest' }) }, [selected, candidates])
  async function pick(item) {
    if (!item) return
    try {
      if (item.id) select(item.id)
      else await openPath(item.path)
      onClose()
    } catch (error) { notify(error.message, true) }
  }
  return <Modal title="快速打开" onClose={onClose} className="search-modal" initialFocusRef={queryInput}>
    <div className="search-input"><Search size={18}/><input ref={queryInput} placeholder="输入文件名或路径" aria-label="筛选文件"
      role="combobox" aria-expanded={Boolean(candidates.length)} aria-controls={listId} aria-autocomplete="list"
      aria-activedescendant={selected >= 0 ? `${listId}-${selected}` : undefined}
      value={query} onChange={event => { setQuery(event.target.value); setIndex(0) }} onKeyDown={event => {
        if (isComposingKey(event.nativeEvent)) return
        if (event.key === 'Enter') { event.preventDefault(); void pick(candidates[selected]) }
        if (candidates.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
          event.preventDefault()
          const offset = event.key === 'ArrowDown' ? 1 : -1
          setIndex((selected + offset + candidates.length) % candidates.length)
        }
      }}/></div>
    <div className="search-results" id={listId} role="listbox" aria-label="匹配的文件" hidden={!candidates.length}>
      {candidates.map((item, i) => <button className={selected === i ? 'selected' : ''} key={item.path ?? item.id}
        ref={selected === i ? selectedResult : null} id={`${listId}-${i}`} role="option" aria-selected={selected === i} tabIndex={-1}
        onMouseDown={event => event.preventDefault()} onPointerMove={() => setIndex(i)}
        onClick={() => pick(item)}><FileText size={16}/><span>{item.name}<small>{item.path}</small></span></button>)}
    </div>
    {!candidates.length && <p className="sidebar-note" role="status">没有匹配的文件。</p>}
  </Modal>
}

export function GoToLine({ text, onClose, onJump }) {
  const [line, setLine] = useState('')
  const input = useRef(null)
  const limit = text.split(/\r\n|\n|\r/).length
  const valid = /^\d+$/.test(line) && Number(line) >= 1 && Number(line) <= limit
  return <Modal title="跳转到行" onClose={onClose} initialFocusRef={input}>
    <form onSubmit={event => { event.preventDefault(); if (valid) onJump(Number(line)) }}>
      <label className="text-setting">行号
        <input ref={input} inputMode="numeric" value={line} onChange={event => setLine(event.target.value)}
          placeholder={`1–${limit}`} aria-describedby="line-range"/>
      </label>
      <p className="modal-detail" id="line-range">共 {limit} 行，跳转后在源码中定位。</p>
      <footer><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={!valid}>跳转</button></footer>
    </form>
  </Modal>
}

export function FolderSearch({ path, close, jump, notify }) {
  const [query, setQuery] = useState('')
  const [flags, setFlags] = useState({ caseSensitive: false, wholeWord: false, regex: false })
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const request = useRef(0)
  useEffect(() => () => { request.current++; desktop.cancelSearch?.() }, [])
  async function run(event) {
    event.preventDefault()
    if (!query.trim() || !path) return
    const sequence = ++request.current
    setBusy(true)
    try {
      const next = await desktop.searchDirectory({ path, query, ...flags })
      if (sequence === request.current) setResult(next)
    } catch (error) {
      if (sequence === request.current) notify(error.message, true)
    } finally {
      if (sequence === request.current) setBusy(false)
    }
  }
  return <Modal title="搜索工作区" onClose={close} className="search-modal">
    <form onSubmit={run}>
      <div className="search-input"><Search size={18}/><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索文档内容" aria-label="工作区搜索文字"/>
        <button className="primary" disabled={busy || !path}>搜索</button></div>
      <div className="find-options">{[['caseSensitive','区分大小写'], ['wholeWord','全词'], ['regex','正则表达式']].map(([key, label]) =>
        <label key={key}><input type="checkbox" checked={flags[key]} onChange={event => setFlags({ ...flags, [key]: event.target.checked })}/>{label}</label>)}</div>
    </form>
    <div className="search-results">
      {!path && <p className="sidebar-note">请先打开一个文件夹。</p>}
      {busy && <p className="sidebar-note">正在搜索…</p>}
      {result && <p className="sidebar-note">{result.matches.length} 处匹配{result.truncated && '（已达到显示上限）'}</p>}
      {result?.matches.map(({ path: file, name, line, column, text }, index) =>
        <button key={index} onClick={() => jump(file, line)} title={file}><FileText size={15}/><span>{name} · 第 {line} 行，第 {column} 列<small>{text}</small></span></button>)}
    </div>
  </Modal>
}

const preferences = [
  ['sidebar', '显示侧栏'], ['focusMode', '专注模式'], ['typewriter', '打字机模式'],
  ['proseSpellcheck', '正文拼写检查'], ['autoSave', '自动保存已有文件'], ['resume', '恢复上次打开的文档'],
  ['wrap', '源码自动换行'], ['showHidden', '显示隐藏文件'], ['remoteMedia', '显示网络图片'],
]

export function Settings({ settings, configure, close, native, fonts, initialPanel = 'appearance' }) {
  const [panel, setPanel] = useState(initialPanel)
  return <Modal title="设置" onClose={close} className="settings-modal">
    <nav className="settings-nav" aria-label="设置分类">
      {[['appearance','外观'],['fonts','字体'],['writing','编辑'],['files','文件与资源'],['shortcuts','快捷键']].map(([key, name]) =>
        <button key={key} className={key === panel ? 'selected' : ''} aria-pressed={key === panel} onClick={() => setPanel(key)}>{name}</button>)}
    </nav>
    <div className="settings-body">
      {panel === 'appearance' && <ThemeSettings settings={settings} configure={configure}/>}
      {panel === 'fonts' && <FontSettings settings={settings} configure={configure} fonts={fonts}/>}
      {panel === 'writing' && <>
        <label className="setting"><span>默认编辑模式</span><select value={settings.mode} onChange={event => configure({ mode: event.target.value })}>
          <option value="live">即时</option><option value="source">源码</option><option value="split">分栏</option>
        </select></label>
        {preferences.slice(0, 4).concat(preferences.slice(6, 7)).map(([key, label]) => <label key={key} className="setting"><span>{label}</span>
          <input type="checkbox" checked={!!settings[key]} onChange={event => configure({ [key]: event.target.checked })}/></label>)}
      </>}
      {panel === 'files' && <>
        {preferences.slice(4, 6).concat(preferences.slice(7)).map(([key, label]) => <label key={key} className="setting"><span>{label}</span>
          <input type="checkbox" checked={!!settings[key]} onChange={event => configure({ [key]: event.target.checked })}/></label>)}
        <label className="text-setting">文档图片目录<input disabled={!native} value={settings.imageFolder} placeholder="默认使用文档名.assets" onChange={event => configure({ imageFolder: event.target.value })}/></label>
        <label className="text-setting">图片根路径<input disabled={!native} value={settings.imageRoot} placeholder="用于解析从 / 开始的图片路径" onChange={event => configure({ imageRoot: event.target.value })}/></label>
        <label className="text-setting">图片上传程序<input disabled={!native} value={settings.uploader} placeholder="程序的完整路径" onChange={event => configure({ uploader: event.target.value })}/></label>
        <label className="text-setting">上传参数（每行一个）<textarea disabled={!native} value={settings.uploaderArgs} rows="2" onChange={event => configure({ uploaderArgs: event.target.value })}/></label>
      </>}
      {panel === 'shortcuts' && <ShortcutSettings hotkeys={settings.hotkeys} platform={desktop.platform}
        onChange={hotkeys => configure({ hotkeys })}/>}
    </div>
  </Modal>
}

export function ExportDialog({ name, close, run }) {
  const [format, setFormat] = useState('pdf')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pageSize, setPageSize] = useState('A4')
  const [landscape, setLandscape] = useState(false)
  const [writer, setWriter] = useState('')
  const [extension, setExtension] = useState('')
  return <Modal title="导出文档" onClose={() => { if (!busy) close() }}>
    <form onSubmit={async event => {
      event.preventDefault()
      setBusy(true)
      setError('')
      try { if (await run(format, { pageSize, landscape, writer, extension })) close() }
      catch (failure) { setError(failure.message) }
      finally { setBusy(false) }
    }}>
      <p className="modal-detail">{name}</p>
      <label className="setting"><span>格式</span><select value={format} onChange={event => setFormat(event.target.value)}>
        {formats.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      {format === 'pdf' && <>
        <label className="setting"><span>纸张</span><select value={pageSize} onChange={event => setPageSize(event.target.value)}>
          {['A4','A3','A5','Letter','Legal','Tabloid'].map(size => <option key={size}>{size}</option>)}
        </select></label>
        <label className="setting"><span>横向</span><input type="checkbox" checked={landscape} onChange={event => setLandscape(event.target.checked)}/></label>
      </>}
      {format === 'custom' && <>
        <label className="text-setting">Pandoc 输出格式<input required value={writer} onChange={event => setWriter(event.target.value)} placeholder="例如 asciidoc"/></label>
        <label className="text-setting">文件扩展名<input required pattern="[A-Za-z0-9]{1,16}" value={extension} onChange={event => setExtension(event.target.value)} placeholder="例如 adoc"/></label>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={close}>取消</button><button type="submit" className="primary" disabled={busy}>{busy ? '正在生成…' : '导出'}</button></footer>
    </form>
  </Modal>
}

export function Recovery({ drafts, close, recover, discard, notify }) {
  return <Modal title="恢复草稿" onClose={close}>
    {drafts.length ? drafts.map(draft => <div className="recover-row" key={draft.id}>
      <RotateCcw size={17}/><span>{draft.name}<small>{draft.path || '未保存到磁盘'}{draft.updatedAt && ' · ' + new Date(draft.updatedAt).toLocaleString()}</small></span>
      <button onClick={async () => {
        try { await recover(draft.id); close() } catch (error) { notify(error.message, true) }
      }}>恢复</button><button onClick={() => discard(draft)}>删除</button>
    </div>) : <p className="modal-detail">没有待恢复的草稿。</p>}
  </Modal>
}

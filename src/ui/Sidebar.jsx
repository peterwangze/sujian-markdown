import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, List, FolderSearch, RotateCcw, Pin, FolderPlus, MoreHorizontal, ArrowUpDown } from 'lucide-react'
import { desktop, native } from '../workspace/desktop.js'
import { IconButton } from './Controls.jsx'

function pathTail(path) { return path?.split(/[\\/]/).filter(Boolean).at(-1) ?? '' }

function FileTree({ path, level, expanded, settings, refresh, active, onOpen, onContext, notify }) {
  const [nodes, setNodes] = useState(null)
  const [error, setError] = useState('')
  const [children, setChildren] = useState({})
  useEffect(() => {
    let current = true
    setError('')
    const request = settings.fileList && level === 0
      ? desktop.findDocuments(path, { showHidden: settings.showHidden, limit: 2500 })
      : desktop.listDirectory(path, { showHidden: settings.showHidden })
    Promise.resolve(request).then(result => {
      if (!current) return
      const files = Array.isArray(result) ? result : result.files ?? result.documents ?? []
      setNodes(files.map(file => typeof file === 'string' ? { path: file, name: pathTail(file), kind: 'file' } : file))
    }).catch(failure => { if (current) setError(failure.message) })
    return () => { current = false }
  }, [path, level, refresh, settings.fileList, settings.showHidden])

  if (!expanded) return null
  if (error) return <div className="sidebar-note">{error}</div>
  if (!nodes) return <div className="sidebar-note">正在读取…</div>
  const visible = [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    if (settings.fileSort === 'recent') return (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0)
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
  })
  return visible.map(item => {
    const directory = item.kind === 'directory'
    const open = !!children[item.path]
    return <div key={item.path}>
      <button className={'tree-row ' + (active?.path === item.path ? 'selected' : '')} style={{ '--indent': level + 1 }}
        title={item.path} aria-expanded={directory ? open : undefined}
        onClick={() => directory ? setChildren(previous => ({ ...previous, [item.path]: !open })) : onOpen(item.path).catch(failure => notify(failure.message, true))}
        onContextMenu={event => onContext(event, item)}>
        {directory && (open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>)}
        {directory ? <Folder size={16}/> : <FileText size={15}/>}<span>{item.name}</span>
      </button>
      {directory && open && <FileTree path={item.path} level={level + 1} expanded={open} settings={settings}
        refresh={refresh} active={active} onOpen={onOpen} onContext={onContext} notify={notify}/>}
    </div>
  })
}

export function Sidebar({ workspace, sidebar, setSidebar, outline, jump, openFolder, searchFolder, refresh, notify, onContext, openRecovery }) {
  const { active, docs, settings, select, openPath, configure, recoverable } = workspace
  const [rootOpen, setRootOpen] = useState(true)
  const [collapsed, setCollapsed] = useState(new Set())
  useEffect(() => { setRootOpen(true) }, [settings.workspace])
  useEffect(() => { setCollapsed(new Set()) }, [active?.id])
  const visibleOutline = outline.filter((entry, index) => {
    let depth = entry.depth
    for (let n = index - 1; n >= 0 && depth > 1; n--) {
      const parent = outline[n]
      if (parent.depth < depth) {
        if (collapsed.has(parent.line)) return false
        depth = parent.depth
      }
    }
    return true
  })
  return <aside className="sidebar" aria-label="文件与大纲">
    <div className="sidebar-tabs">
      <button className={sidebar === 'files' ? 'selected' : ''} onClick={() => setSidebar('files')}>文件</button>
      <button className={sidebar === 'outline' ? 'selected' : ''} onClick={() => setSidebar('outline')}>大纲</button>
      {sidebar === 'files' && <IconButton icon={FolderPlus} label="打开文件夹" disabled={!native} onClick={openFolder}/>}
    </div>
    <div className="sidebar-content">
      {sidebar === 'outline' ? (
        visibleOutline.length ? visibleOutline.map(item => {
          const index = outline.indexOf(item)
          const child = outline[index + 1]?.depth > item.depth
          return <div className="outline-row" key={item.line} style={{ '--indent': item.depth - 1 }}>
            {child ? <button aria-label={collapsed.has(item.line) ? '展开小节' : '折叠小节'}
              onClick={() => setCollapsed(previous => {
                const next = new Set(previous)
                if (next.has(item.line)) next.delete(item.line)
                else next.add(item.line)
                return next
              })}>{collapsed.has(item.line) ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}</button> : <span/>}
            <button onClick={() => jump(item.line)} title={item.title}>{item.title}</button>
          </div>
        }) : <p className="sidebar-note">文档中的标题会出现在这里。</p>
      ) : <>
        <div className="tree-root">
          <button className="tree-row" aria-expanded={rootOpen} onClick={() => setRootOpen(!rootOpen)}>
            {rootOpen ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}<FolderOpen size={17}/><span>{pathTail(settings.workspace) || '工作区'}</span>
          </button>
          {settings.workspace && <>
            <IconButton icon={List} label={settings.fileList ? '切换文件树' : '切换文件列表'}
              pressed={settings.fileList} onClick={() => configure({ fileList: !settings.fileList })}/>
            <IconButton icon={ArrowUpDown} label="切换按名称或修改时间排序" onClick={() => configure({ fileSort: settings.fileSort === 'name' ? 'recent' : 'name' })}/>
            <IconButton icon={FolderSearch} label="在工作区内搜索" onClick={searchFolder}/>
          </>}
        </div>
        {settings.workspace ? <FileTree path={settings.workspace} level={0} expanded={rootOpen} settings={settings}
          refresh={refresh} active={active} onOpen={openPath} onContext={onContext} notify={notify}/> :
          rootOpen && docs.map(doc => <button key={doc.id} className={'tree-row ' + (doc.id === active?.id ? 'selected' : '')}
            style={{ '--indent': 1 }} onClick={() => select(doc.id)} title={doc.path || doc.name}><FileText size={15}/><span>{doc.name}</span></button>)}
        {settings.pinned.length > 0 && <section className="sidebar-section">
          <h3>固定文件夹</h3>
          {settings.pinned.map(path => <div className="sidebar-split-row" key={path}>
            <button className="tree-row" title={path} onClick={() => configure({ workspace: path })}><Pin size={14}/><span>{pathTail(path)}</span></button>
            <IconButton icon={MoreHorizontal} label="取消固定" onClick={() => configure({ pinned: settings.pinned.filter(item => item !== path) })}/>
          </div>)}
        </section>}
        {settings.recent.length > 0 && <section className="sidebar-section">
          <h3>最近打开</h3>
          {settings.recent.slice(0, 8).map(path => <button key={path} className="tree-row" title={path}
            onClick={() => openPath(path).catch(failure => notify(failure.message, true))}><FileText size={15}/><span>{pathTail(path)}</span></button>)}
        </section>}
      </>}
    </div>
    {recoverable.length > 0 && <button className="sidebar-recover" onClick={openRecovery}><RotateCcw size={16}/> 恢复草稿 <span>{recoverable.length}</span></button>}
  </aside>
}

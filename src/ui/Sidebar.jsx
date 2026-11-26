import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, List, FolderSearch, RotateCcw, FolderPlus, MoreHorizontal, ArrowUpDown } from 'lucide-react'
import { desktop, native } from '../workspace/desktop.js'
import { isComposingKey } from '../workspace/commands.js'
import { IconButton } from './Controls.jsx'
import { documentContextEvents } from './DocumentContextMenu.jsx'

function pathTail(path) { return path?.split(/[\\/]/).filter(Boolean).at(-1) ?? '' }

function toggleMember(set, value) {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function navigateRows(event) {
  if (isComposingKey(event.nativeEvent) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const row = event.target.closest('[data-sidebar-row]')
  if (!row) return
  const rows = [...event.currentTarget.querySelectorAll('[data-sidebar-row]')]
  const index = rows.indexOf(row)
  const level = Number(row.dataset.level)
  const expandable = row.getAttribute('aria-expanded')
  let next
  switch (event.key) {
    case 'ArrowUp': next = rows[index - 1]; break
    case 'ArrowDown': next = rows[index + 1]; break
    case 'Home': next = rows[0]; break
    case 'End': next = rows.at(-1); break
    case 'ArrowRight':
      if (expandable === 'false') row.click()
      else if (Number(rows[index + 1]?.dataset.level) > level) next = rows[index + 1]
      break
    case 'ArrowLeft':
      if (expandable === 'true') row.click()
      else next = rows.slice(0, index).findLast(item => Number(item.dataset.level) < level)
      break
    default: return
  }
  event.preventDefault()
  next?.focus()
}

function FileTree({ path, level, expanded, settings, refresh, watchDirectory, folderToExpand, active, onOpen, onContext, notify }) {
  const [nodes, setNodes] = useState(null)
  const [error, setError] = useState('')
  const [children, setChildren] = useState({})
  const expandedRequest = useRef(null)
  const flat = settings.fileList && level === 0
  const watchContentChanges = !flat && settings.fileSort === 'recent'
  useEffect(() => {
    if (!expanded) return
    let current = true
    let reading = false
    let changedDuringRead = false
    const showHidden = settings.showHidden
    async function read() {
      if (reading) {
        changedDuringRead = true
        return
      }
      reading = true
      do {
        changedDuringRead = false
        try {
          const result = flat
            ? await desktop.findDocuments(path, { showHidden, limit: 2500 })
            : await desktop.listDirectory(path, { showHidden })
          if (!current) return
          const files = Array.isArray(result) ? result : result.files ?? result.documents ?? []
          setNodes(files.map(file => typeof file === 'string' ? { path: file, name: pathTail(file), kind: 'file' } : file))
          setError('')
        } catch (failure) {
          if (current) setError(failure.message)
        }
      } while (current && changedDuringRead)
      reading = false
    }
    const unwatch = watchDirectory({ path, recursive: flat, showHidden, watchContentChanges }, read)
    void read()
    return () => {
      current = false
      unwatch?.()
    }
  }, [path, expanded, refresh, flat, settings.showHidden, watchContentChanges, watchDirectory])
  useEffect(() => {
    const target = folderToExpand?.path
    if (target && expandedRequest.current !== folderToExpand &&
      nodes?.some(item => item.kind === 'directory' && item.path === target)) {
      expandedRequest.current = folderToExpand
      setChildren(previous => previous[target] ? previous : { ...previous, [target]: true })
    }
  }, [folderToExpand, nodes])

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
        data-sidebar-row data-level={level + 1} title={item.path} aria-expanded={directory ? open : undefined}
        aria-current={active?.path === item.path ? 'true' : undefined}
        onClick={() => directory ? setChildren(previous => ({ ...previous, [item.path]: !open })) : onOpen(item.path).catch(failure => notify(failure.message, true))}
        {...documentContextEvents(item, onContext)}>
        {directory ? (open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>) :
          !settings.fileList && <span className="tree-disclosure-space" aria-hidden="true"/>}
        {directory ? <Folder size={16}/> : <FileText size={16}/>}<span>{item.name}</span>
      </button>
      {directory && open && <FileTree path={item.path} level={level + 1} expanded={open} settings={settings}
        refresh={refresh} watchDirectory={watchDirectory} folderToExpand={folderToExpand} active={active}
        onOpen={onOpen} onContext={onContext} notify={notify}/>}
    </div>
  })
}

const minSidebar = 150;
const maxSidebar = 640;
// The editor keeps this much room, whatever width was chosen.
const editorRoom = 480;

function useViewport() {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    let frame = 0
    const resize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setWidth(window.innerWidth))
    }
    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [])
  return width
}

export function Sidebar({ workspace, sidebar, setSidebar, outline, jump, addFolder, searchFolder, refresh, folderToExpand, notify,
  onContext, onOpenPath, onSelectDocument, openRecovery }) {
  const { active, docs, settings, configure, recoverable } = workspace
  const [rootOpen, setRootOpen] = useState(true)
  const [collapsed, setCollapsed] = useState(new Set())
  const [folded, setFolded] = useState(new Set())
  const expandedRequest = useRef(null)
  const aside = useRef(null)
  const grip = useRef(null)
  const drag = useRef(null)
  const viewport = useViewport()
  const widest = Math.max(minSidebar, Math.min(maxSidebar, viewport - editorRoom))
  const fit = (width) => Math.max(minSidebar, Math.min(widest, width))
  // Without a chosen width the sidebar is as wide as the style sheet says for this window size.
  const width = settings.sidebarWidth ? Math.min(settings.sidebarWidth, widest) : viewport > 1170 ? 230 : viewport > 960 ? 202 : 172
  // Pinned folders are trees of their own. The workspace is already at the top.
  const pinned = settings.pinned.filter(path => path !== settings.workspace)
  const directorySubscriptions = useRef(new Map())
  const directorySyncScheduled = useRef(false)
  const syncDirectorySubscriptions = useCallback(() => {
    if (directorySyncScheduled.current) return
    directorySyncScheduled.current = true
    queueMicrotask(() => {
      directorySyncScheduled.current = false
      void desktop.setWatchedDirectories([...directorySubscriptions.current.keys()]).catch(() => {})
    })
  }, [])
  const watchDirectory = useCallback((options, read) => {
    if (!desktop.setWatchedDirectories) return
    directorySubscriptions.current.set(options, read)
    syncDirectorySubscriptions()
    return () => {
      directorySubscriptions.current.delete(options)
      syncDirectorySubscriptions()
    }
  }, [syncDirectorySubscriptions])
  useLayoutEffect(() => desktop.onDirectoryChange?.(({ paths }) => {
    const changed = new Set(paths)
    for (const [options, read] of directorySubscriptions.current) {
      if (changed.has(options.path)) void read()
    }
  }), [])
  useEffect(() => { setRootOpen(true) }, [settings.workspace])
  useEffect(() => { if (folderToExpand?.path === settings.workspace) setRootOpen(true) }, [folderToExpand, settings.workspace])
  useEffect(() => {
    const path = folderToExpand?.path
    if (!path || expandedRequest.current === folderToExpand) return
    expandedRequest.current = folderToExpand
    setFolded(previous => {
      if (!previous.has(path)) return previous
      const next = new Set(previous)
      next.delete(path)
      return next
    })
  }, [folderToExpand])
  useEffect(() => { setCollapsed(new Set()) }, [active?.id])
  const visibleOutline = useMemo(() => {
    const visible = []
    const sections = []
    for (const [index, entry] of outline.entries()) {
      while (sections.at(-1)?.depth >= entry.depth) sections.pop()
      const hidden = sections.at(-1)?.hidden
      if (!hidden) visible.push({ ...entry, child: outline[index + 1]?.depth > entry.depth })
      sections.push({ depth: entry.depth, hidden: hidden || collapsed.has(entry.line) })
    }
    return visible
  }, [outline, collapsed])
  const current = () => Math.round(aside.current.getBoundingClientRect().width)
  // The move is followed on the window, so it goes on wherever the pointer is.
  function startResize(event) {
    if (event.button !== 0) return
    event.preventDefault()
    const left = aside.current.getBoundingClientRect().left
    const offset = event.clientX - aside.current.getBoundingClientRect().right
    let width = current()
    document.documentElement.classList.add('resizing-sidebar')
    const move = (moved) => {
      // After a layout change Chromium asks what lies under the pointer. That move may carry no pressed button.
      if (!(moved.buttons & 1) || !aside.current) return
      width = fit(Math.round(moved.clientX - offset - left))
      aside.current.style.setProperty('--sidebar-width', width + 'px')
      grip.current.setAttribute('aria-valuenow', String(width))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
      document.documentElement.classList.remove('resizing-sidebar')
      drag.current = null
      if (width !== settings.sidebarWidth) configure({ sidebarWidth: width })
    }
    drag.current = stop
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
  }
  useEffect(() => () => drag.current?.(), [])
  function resizeByKey(event) {
    if (isComposingKey(event.nativeEvent) || event.altKey || event.ctrlKey || event.metaKey) return
    const step = event.shiftKey ? 64 : 16
    let next
    switch (event.key) {
      case 'ArrowLeft': next = current() - step; break
      case 'ArrowRight': next = current() + step; break
      case 'Home': next = minSidebar; break
      case 'End': next = widest; break
      default: return
    }
    event.preventDefault()
    event.stopPropagation()
    configure({ sidebarWidth: fit(next) })
  }
  const unpin = (path) => configure({ pinned: settings.pinned.filter(item => item !== path) })
  return <aside ref={aside} className="sidebar" aria-label="文件与大纲"
    style={settings.sidebarWidth ? { '--sidebar-width': width + 'px' } : undefined}>
    <div className="sidebar-tabs">
      <button className={sidebar === 'files' ? 'selected' : ''} aria-pressed={sidebar === 'files'} onClick={() => setSidebar('files')}>文件</button>
      <button className={sidebar === 'outline' ? 'selected' : ''} aria-pressed={sidebar === 'outline'} onClick={() => setSidebar('outline')}>大纲</button>
      {sidebar === 'files' && <IconButton icon={FolderPlus} label={settings.workspace ? '添加文件夹' : '打开文件夹'} disabled={!native} onClick={addFolder}/>}
    </div>
    <div className="sidebar-content" onKeyDown={navigateRows}>
      {sidebar === 'outline' ? (
        visibleOutline.length ? visibleOutline.map(item => {
          return <div className="outline-row" key={item.line} style={{ '--indent': item.depth - 1 }}>
            {item.child ? <button aria-label={collapsed.has(item.line) ? '展开小节' : '折叠小节'}
              onClick={() => setCollapsed(previous => {
                const next = new Set(previous)
                if (next.has(item.line)) next.delete(item.line)
                else next.add(item.line)
                return next
              })}>{collapsed.has(item.line) ? <ChevronRight size={13}/> : <ChevronDown size={13}/>}</button> : <span/>}
            <button data-sidebar-row onClick={() => jump(item.line)} title={item.title}>{item.title}</button>
          </div>
        }) : <p className="sidebar-note">文档中的标题会出现在这里。</p>
      ) : <>
        <div className="tree-root">
          <button className="tree-row" data-sidebar-row data-level="0" aria-expanded={rootOpen} onClick={() => setRootOpen(!rootOpen)}
            {...documentContextEvents({ path: settings.workspace, name: pathTail(settings.workspace), kind: 'directory' }, settings.workspace ? onContext : null)}>
            {rootOpen ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}<FolderOpen size={16}/><span>{pathTail(settings.workspace) || '工作区'}</span>
          </button>
          {settings.workspace && <>
            <IconButton icon={List} label={settings.fileList ? '切换文件树' : '切换文件列表'}
              pressed={settings.fileList} onClick={() => configure({ fileList: !settings.fileList })}/>
            <IconButton icon={ArrowUpDown} label="切换按名称或修改时间排序" onClick={() => configure({ fileSort: settings.fileSort === 'name' ? 'recent' : 'name' })}/>
            <IconButton icon={FolderSearch} label="在工作区内搜索" onClick={searchFolder}/>
          </>}
        </div>
        {settings.workspace ? <FileTree key={settings.workspace} path={settings.workspace} level={0} expanded={rootOpen} settings={settings}
          refresh={refresh} watchDirectory={watchDirectory} folderToExpand={folderToExpand} active={active}
          onOpen={onOpenPath} onContext={onContext} notify={notify}/> :
          rootOpen && docs.map(doc => <button key={doc.id} className={'tree-row ' + (doc.id === active?.id ? 'selected' : '')}
            data-sidebar-row data-level="1" aria-current={doc.id === active?.id ? 'true' : undefined}
            style={{ '--indent': 1 }} onClick={() => onSelectDocument(doc.id)} title={doc.path || doc.name}
            {...documentContextEvents({ kind: 'file', id: doc.id, path: doc.path, name: doc.name }, onContext)}>
            <span className="tree-disclosure-space" aria-hidden="true"/><FileText size={16}/><span>{doc.name}</span>
          </button>)}
        {pinned.length > 0 && <section className="sidebar-section">
          <h3>固定文件夹</h3>
          {pinned.map(path => {
            const open = !folded.has(path)
            return <div key={path}>
              <div className="sidebar-split-row">
                <button className="tree-row sidebar-folder" data-sidebar-row data-level="0" aria-expanded={open} title={path}
                  onClick={() => setFolded(previous => toggleMember(previous, path))}
                  {...documentContextEvents({ kind: 'directory', path, name: pathTail(path) }, onContext)}>
                  {open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}<FolderOpen size={16}/><span>{pathTail(path)}</span>
                </button>
                <IconButton icon={MoreHorizontal} label="取消固定" onClick={() => unpin(path)}/>
              </div>
              {open && <FileTree key={path} path={path} level={0} expanded settings={settings}
                refresh={refresh} watchDirectory={watchDirectory} folderToExpand={folderToExpand} active={active}
                onOpen={onOpenPath} onContext={onContext} notify={notify}/>}
            </div>
          })}
        </section>}
        {settings.recent.length > 0 && <section className="sidebar-section">
          <h3>最近打开</h3>
          {settings.recent.slice(0, 8).map(path => <button key={path} className="tree-row" data-sidebar-row title={path}
            onClick={() => onOpenPath(path).catch(failure => notify(failure.message, true))}
            {...documentContextEvents({ kind: 'file', path, name: pathTail(path) }, onContext)}><FileText size={15}/><span>{pathTail(path)}</span></button>)}
        </section>}
      </>}
    </div>
    {recoverable.length > 0 && <button className="sidebar-recover" onClick={openRecovery}><RotateCcw size={16}/> 恢复草稿 <span>{recoverable.length}</span></button>}
    <div ref={grip} className="sidebar-resize" role="separator" aria-orientation="vertical" tabIndex={0} aria-label="调整侧边栏宽度"
      aria-valuemin={minSidebar} aria-valuemax={widest} aria-valuenow={width} title="拖动调整宽度，双击恢复默认"
      onPointerDown={startResize} onKeyDown={resizeByKey} onDoubleClick={() => configure({ sidebarWidth: null })}/>
  </aside>
}

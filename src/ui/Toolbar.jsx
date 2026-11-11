import { useEffect, useRef, useState } from 'react'
import { Bold, Italic, List, ListOrdered, Table2, Link, Search, Settings2, ChevronDown,
  PanelLeft, MoreHorizontal, FileText, FolderOpen, Save, FileOutput, FileInput, Image,
  Code, Quote, Minus, SquareCheck, Strikethrough, Sigma, Network, Focus, Maximize, Undo2, Redo2, Keyboard,
  Columns2, BookOpen, Copy, Pin, Printer, Moon } from 'lucide-react'
import { IconButton } from './Controls.jsx'

function Menu({ items, icon, label, children, className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const stop = event => {
      if ((event.type === 'keydown' && event.key === 'Escape') ||
        (event.type === 'pointerdown' && !ref.current.contains(event.target))) setOpen(false)
    }
    document.addEventListener('pointerdown', stop)
    document.addEventListener('keydown', stop)
    return () => {
      document.removeEventListener('pointerdown', stop)
      document.removeEventListener('keydown', stop)
    }
  }, [open])
  return <div className={'tool-menu ' + className} ref={ref}>
    {icon ? <IconButton icon={icon} label={label} aria-expanded={open} onClick={() => setOpen(!open)}/> :
      <button className="heading-button" aria-label={label} title={label} aria-expanded={open}
        onMouseDown={event => event.preventDefault()} onClick={() => setOpen(!open)}>{children}<ChevronDown size={12}/></button>}
    {open && <div className="tool-menu-list">
      {items.map(({ name, icon: Icon, run, disabled }, index) => name ?
        <button key={name} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => { setOpen(false); run() }}>
          {Icon && <Icon size={15}/>}<span>{name}</span>
        </button> : <hr key={index}/>)}
    </div>}
  </div>
}

export function Toolbar({ active, mode, setMode, action, command, settings, native }) {
  const act = (name, icon, key, disabled = false) => ({ name, icon, run: () => action(key), disabled })
  const fmt = (name, icon, key) => ({ name, icon, run: () => command(key), disabled: !active })
  const icon = (Icon, label, key) => <IconButton icon={Icon} label={label} disabled={!active}
    onMouseDown={event => event.preventDefault()} onClick={() => command(key)}/>
  return <div className="toolbar" role="toolbar" aria-label="编辑工具">
    {!settings.sidebar && <IconButton icon={PanelLeft} label="显示侧栏" onClick={() => action('toggle-sidebar')}/>}
    <div className="format-tools">
      <Menu label="标题级别" items={[1, 2, 3, 4, 5, 6].map(level => ({ name: level + ' 级标题', run: () => command('heading', level) }))}>H₁</Menu>
      {icon(Bold, '加粗', 'bold')}{icon(Italic, '斜体', 'italic')}
      <div className="wide-tools">{icon(List, '无序列表', 'list')}{icon(ListOrdered, '有序列表', 'ordered-list')}</div>
      {icon(Table2, '插入表格', 'table')}{icon(Link, '插入链接', 'link')}
      <Menu icon={MoreHorizontal} label="更多编辑工具" items={[
        fmt('无序列表', List, 'list'), fmt('有序列表', ListOrdered, 'ordered-list'),
        fmt('任务列表', SquareCheck, 'check'), fmt('引用', Quote, 'quote'), fmt('行内代码', Code, 'inline-code'),
        fmt('代码块', Code, 'code'), fmt('删除线', Strikethrough, 'strike'), fmt('分隔线', Minus, 'line'),
        fmt('高亮', null, 'highlight'), fmt('下划线', null, 'underline'),
        fmt('上标', null, 'superscript'), fmt('下标', null, 'subscript'),
        fmt('公式', Sigma, 'math'), fmt('Mermaid 图表', Network, 'mermaid'),
        fmt('目录', List, 'toc'), fmt('脚注', FileText, 'footnote'),
        act('插入本地图片', Image, 'image', !active), act('上传本地图片', Image, 'upload-images', !active || !native), {},
        fmt('撤销', Undo2, 'undo'), fmt('重做', Redo2, 'redo'),
        act('复制 Markdown', Copy, 'copy-markdown', !active), act('复制富文本', Copy, 'copy-rich', !active),
        act('复制 HTML 源码', Copy, 'copy-html', !active), act('复制纯文本', Copy, 'copy-plain', !active),
      ]}/>
    </div>
    <div className="right-tools">
      <div className="mode-switch" aria-label="编辑模式">
        <button className={mode === 'live' ? 'selected' : ''} aria-pressed={mode === 'live'} disabled={!active} onClick={() => setMode('live')}>即时</button>
        <button className={mode === 'source' ? 'selected' : ''} aria-pressed={mode === 'source'} disabled={!active} onClick={() => setMode('source')}>源码</button>
      </div>
      <IconButton icon={Search} label="查找" disabled={!active} onClick={() => action('find')}/>
      <IconButton icon={Settings2} label="设置" onClick={() => action('settings')}/>
      <Menu icon={MoreHorizontal} label="文档与视图" className="align-right" items={[
        act('新建文档', FileText, 'new-file'), act('打开文件', FolderOpen, 'open-files'),
        act('新建窗口', FileText, 'new-window', !native),
        act('打开文件夹', FolderOpen, 'open-folder', !native), act('快速打开', Search, 'quick-open'),
        act('保存', Save, 'save', !active), act('另存为', Save, 'save-as', !active),
        act('导入文档', FileInput, 'import', !native), act('导出文档', FileOutput, 'export', !active),
        act('打印', Printer, 'print', !active), {},
        act('阅读模式', BookOpen, 'view-read', !active), act('分栏预览', Columns2, 'view-split', !active),
        act('侧栏', PanelLeft, 'toggle-sidebar'), act('专注模式', Focus, 'toggle-focus'),
        act('打字机模式', FileText, 'toggle-typewriter'), act('全屏', Maximize, 'fullscreen'),
        act('切换深色模式', Moon, 'toggle-dark'), act('固定当前文件夹', Pin, 'pin-folder', !settings.workspace),
        act('快捷键', Keyboard, 'shortcuts'),
      ]}/>
    </div>
  </div>
}

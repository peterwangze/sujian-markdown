import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Bold, Italic, List, ListOrdered, Table2, Link, Search, Settings2, ChevronDown,
  PanelLeft, MoreHorizontal, FileText, FolderOpen, Save, FileOutput, FileInput, Image,
  Code, Quote, Minus, SquareCheck, Strikethrough, Sigma, Network, Focus, Maximize, Undo2, Redo2, Keyboard,
  Columns2, BookOpen, Copy, Pin, Printer, Moon, FileDiff, ClipboardCheck, Command } from 'lucide-react'
import { commandsById, displayShortcut, effectiveShortcut, headingCommands, isComposingKey } from '../workspace/commands.js'
import { IconButton } from './Controls.jsx'
import './commands.css'

function Menu({ items, icon, label, children, className = '', preserveEditor = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const trigger = useRef(null)
  const menu = useRef(null)
  const entryPoint = useRef(0)
  const menuId = useId()

  function moveFocus(position) {
    const buttons = menu.current?.querySelectorAll('button:not(:disabled)')
    if (!buttons?.length) return
    buttons[position < 0 ? buttons.length - 1 : position]?.focus()
  }

  useLayoutEffect(() => {
    if (open && entryPoint.current) moveFocus(entryPoint.current === 1 ? 0 : -1)
    entryPoint.current = 0
  }, [open])

  useEffect(() => {
    if (!open) return
    const stop = event => {
      if (event.type === 'pointerdown' && !ref.current?.contains(event.target)) setOpen(false)
      if (event.type === 'keydown' && event.key === 'Escape' && !isComposingKey(event)) setOpen(false)
    }
    document.addEventListener('pointerdown', stop)
    document.addEventListener('keydown', stop)
    return () => {
      document.removeEventListener('pointerdown', stop)
      document.removeEventListener('keydown', stop)
    }
  }, [open])

  function navigate(event) {
    if (isComposingKey(event.nativeEvent) || event.altKey || event.ctrlKey || event.metaKey) return
    const backwards = event.key === 'ArrowUp'
    if (event.target === trigger.current && (event.key === 'ArrowDown' || backwards)) {
      event.preventDefault()
      if (open) moveFocus(backwards ? -1 : 0)
      else { entryPoint.current = backwards ? -1 : 1; setOpen(true) }
      return
    }
    if (!open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
      return
    }
    if (!menu.current?.contains(event.target)) return
    const buttons = Array.from(menu.current.querySelectorAll('button:not(:disabled)'))
    const index = buttons.indexOf(document.activeElement)
    if (index < 0) return
    let next = null
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = buttons.length - 1
    if (event.key === 'ArrowDown' || backwards) next = (index + (backwards ? -1 : 1) + buttons.length) % buttons.length
    if (next !== null) {
      event.preventDefault()
      moveFocus(next)
    }
  }

  function toggle(event) {
    if (!open && event.detail === 0) entryPoint.current = 1
    setOpen(!open)
  }

  function keepSelection(event) {
    if (preserveEditor) event.preventDefault()
  }

  return <div className={'tool-menu ' + className} ref={ref} onKeyDown={navigate}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    {icon ? <IconButton ref={trigger} icon={icon} label={label} aria-expanded={open} aria-controls={open ? menuId : undefined}
      onMouseDown={keepSelection} onClick={toggle}/> :
      <button ref={trigger} className="heading-button" aria-label={label} title={label} aria-expanded={open} aria-controls={open ? menuId : undefined}
        onMouseDown={keepSelection} onClick={toggle}>{children}<ChevronDown size={12}/></button>}
    {open && <div className="tool-menu-list" ref={menu} id={menuId}>
      {items.map(({ name, icon: Icon, run, disabled, shortcut }, index) => name ?
        <button key={name} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={event => {
          if (event.detail === 0) trigger.current?.focus()
          setOpen(false)
          run()
        }}>
          {Icon && <Icon size={15}/>}<span>{name}</span>
          {shortcut && <kbd className="tool-menu-shortcut" aria-hidden="true">{shortcut}</kbd>}
        </button> : <hr key={index}/>)}
    </div>}
  </div>
}

export function Toolbar({ active, mode, setMode, action, command, settings, native, platform, canUndoReview }) {
  const shortcut = key => {
    const item = commandsById.get(key)
    return item ? displayShortcut(effectiveShortcut(item, settings.hotkeys, platform), platform) : ''
  }
  const labelWithShortcut = (label, key) => [label, shortcut(key)].filter(Boolean).join(' · ')
  const act = (name, icon, key, disabled = false) => ({ name, icon, run: () => action(key), disabled, shortcut: shortcut(key) })
  const canFormat = Boolean(active) && mode !== 'read'
  const fmt = (name, icon, key) => ({ name, icon, run: () => command(key), disabled: !canFormat, shortcut: shortcut(key) })
  const icon = (Icon, label, key, className) => <IconButton icon={Icon} label={label} title={labelWithShortcut(label, key)} disabled={!canFormat} className={className}
    onMouseDown={event => event.preventDefault()} onClick={() => command(key)}/>
  return <div className="toolbar" role="toolbar" aria-label="编辑工具">
    {!settings.sidebar && <IconButton icon={PanelLeft} label="显示侧栏" onClick={() => action('toggle-sidebar')}/>}
    <div className="format-tools">
      <Menu label="标题级别" preserveEditor items={headingCommands.map(({ id, label }) => act(label, null, id, !canFormat))}>H₁</Menu>
      {icon(Bold, '加粗', 'bold')}{icon(Italic, '斜体', 'italic')}
      <div className="wide-tools">{icon(List, '无序列表', 'list')}{icon(ListOrdered, '有序列表', 'ordered-list')}</div>
      {icon(Table2, '插入表格', 'table', 'compact-format')}{icon(Link, '插入链接', 'link', 'compact-format')}
      <Menu icon={MoreHorizontal} label="更多编辑工具" preserveEditor items={[
        fmt('无序列表', List, 'list'), fmt('有序列表', ListOrdered, 'ordered-list'),
        fmt('任务列表', SquareCheck, 'check'), fmt('引用', Quote, 'quote'), fmt('行内代码', Code, 'inline-code'),
        fmt('插入表格', Table2, 'table'), fmt('插入链接', Link, 'link'),
        fmt('代码块', Code, 'code'), fmt('删除线', Strikethrough, 'strike'), fmt('分隔线', Minus, 'line'),
        fmt('高亮', null, 'highlight'), fmt('下划线', null, 'underline'),
        fmt('上标', null, 'superscript'), fmt('下标', null, 'subscript'),
        fmt('公式', Sigma, 'math'), fmt('Mermaid 图表', Network, 'mermaid'),
        fmt('目录', List, 'toc'), fmt('脚注', FileText, 'footnote'),
        act('插入本地图片', Image, 'image', !canFormat), act('上传本地图片', Image, 'upload-images', !canFormat || !native), {},
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
      <IconButton icon={Command} label="命令面板" title={labelWithShortcut('命令面板', 'command-palette')} onClick={() => action('command-palette')}/>
      <IconButton icon={Search} label="查找" title={labelWithShortcut('查找', 'find')} disabled={!active} onClick={() => action('find')}/>
      <IconButton icon={Settings2} label="设置" title={labelWithShortcut('设置', 'settings')} onClick={() => action('settings')}/>
      <Menu icon={MoreHorizontal} label="文档与视图" className="align-right" items={[
        act('新建文档', FileText, 'new-file'), act('打开文件', FolderOpen, 'open-files'),
        act('新建窗口', FileText, 'new-window', !native),
        act('打开文件夹', FolderOpen, 'open-folder', !native), act('快速打开', Search, 'quick-open'),
        act('跳转到行', FileText, 'go-to-line', !active),
        act('保存', Save, 'save', !active), act('另存为', Save, 'save-as', !active),
        act('审阅修订稿', FileDiff, 'review', !active), act('撤销本次审阅', Undo2, 'undo-review', !canUndoReview),
        act('从模板创建文档', FileText, 'workflow-templates'), act('检查规格与验收', ClipboardCheck, 'spec-check', !active),
        act('插入来源链接', Link, 'source-link', !active?.path), {},
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

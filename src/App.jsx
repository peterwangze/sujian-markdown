import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FileText, Plus, CircleCheck, AlertTriangle, FolderOpen, ChevronDown, BookOpen } from 'lucide-react'
import { Editor, renderDocument } from './editor/index.js'
import { IconButton, Modal, TabStrip } from './ui/Controls.jsx'
import { Sidebar } from './ui/Sidebar.jsx'
import { Toolbar } from './ui/Toolbar.jsx'
import { ExportDialog, FindBar, FolderSearch, GoToLine, QuickOpen, Recovery, Settings } from './ui/Dialogs.jsx'
import { CommandPalette } from './ui/CommandPalette.jsx'
import { desktop, native } from './workspace/desktop.js'
import { headings, localImageSources, MAX_LIVE_LENGTH, slug, updateImageSources, wordCount } from './workspace/text.js'
import { isDirty, useWorkspace } from './workspace/useWorkspace.js'
import { SpecCheckDialog, SourceLinkDialog, TemplatesDialog } from './review/WorkflowDialogs.jsx'
import { sourceLine, workflowTemplates } from './review/workflows.js'
import { canRunCommand, commandsById, findShortcut, isComposingKey, nativeShortcutOverrides } from './workspace/commands.js'
import { fontStack, useFonts } from './workspace/fonts.js'
import { applyTheme, resolveTheme } from './theme/themes.js'

const ReviewDialog = lazy(() => import('./review/ReviewDialog.jsx'))

const visualExports = new Set(['pdf', 'html', 'html-plain', 'png', 'docx', 'epub', 'print'])
const leaf = path => path?.split(/[\\/]/).filter(Boolean).at(-1) ?? ''

function resolveLink(base, href) {
  const [target, anchor] = href.split('#', 2).map(part => {
    try { return decodeURIComponent(part) } catch { return part }
  })
  if (target && /^(?:[a-z]:[\\/]|[/\\]{1,2})/i.test(target)) return { target, anchor }
  if (!base || !target) return { target, anchor }
  const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(base)
  const separator = windows ? '\\' : '/'
  const start = base.split(/[\\/]/).slice(0, -1)
  const parts = target.split(/[\\/]/)
  const minimum = windows && base.startsWith('\\\\') ? 4 : 1
  for (const part of parts) {
    if (part === '..' && start.length > minimum) start.pop()
    else if (part && part !== '.') start.push(part)
  }
  return { target: start.join(separator), anchor }
}

export default function App() {
  const editor = useRef(null)
  const flushEditor = useCallback(() => editor.current?.getValue(), [])
  const [message, setMessage] = useState(null)
  const noticeTimer = useRef(null)
  const notify = useCallback((text, error = false) => {
    clearTimeout(noticeTimer.current)
    setMessage({ text, error })
    noticeTimer.current = setTimeout(() => setMessage(null), error ? 7500 : 3000)
  }, [])
  const workspace = useWorkspace(notify, flushEditor)
  const fonts = useFonts(notify)
  const { docs, active, settings, configure, amend, ready } = workspace
  const [sidebar, setSidebar] = useState('files')
  const [dialog, setDialog] = useState(null)
  const [commandQueue, setCommandQueue] = useState([])
  const [findState, setFindState] = useState(null)
  const findControl = useRef(null)
  const [selection, setSelection] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [context, setContext] = useState(null)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const activeId = useRef(null)
  activeId.current = active?.id
  const requestedJump = useRef(null)
  const mode = active?.mode ?? settings.mode
  const reviewDoc = dialog?.type === 'review' ? docs.find(doc => doc.id === dialog.docId) : null
  const canUndoReview = !!active?.reviewUndo && active.text === active.reviewUndo.after
  const selectedTheme = resolveTheme(settings.theme, systemDark)
  const dark = selectedTheme.scheme === 'dark'
  const renderTheme = selectedTheme.id
  const activeFonts = fonts.imported.filter(font => !fonts.unavailable.includes(font.id))
  const fontsCss = `:root{--sans:${fontStack('uiFont', settings.uiFont, activeFonts)};` +
    `--serif:${fontStack('bodyFont', settings.bodyFont, activeFonts)};--mono:${fontStack('sourceFont', settings.sourceFont, activeFonts)}}`
  const modalOpen = !!dialog
  const commandContext = useRef(null)
  commandContext.current = { active, mode, settings, native, canUndoReview, tabCount: docs.length }
  const deferredText = useDeferredValue(active?.text ?? '')
  const outline = useMemo(() => headings(deferredText), [deferredText])
  const words = useMemo(() => wordCount(deferredText), [deferredText])
  const run = useCallback(work => Promise.resolve().then(work).catch(error => { notify(error.message ?? String(error), true) }), [notify])
  const closeDialog = () => setDialog(null)

  useEffect(() => {
    if ((dialog?.type === 'review' && !reviewDoc) || (dialog?.type === 'source-link' && active?.id !== dialog.docId)) {
      setDialog(previous => previous === dialog ? null : previous)
    }
  }, [active?.id, dialog, reviewDoc])

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const change = event => setSystemDark(event.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])

  useLayoutEffect(() => { applyTheme(document.documentElement, selectedTheme) }, [selectedTheme])
  useEffect(() => {
    run(() => desktop.setTitleBarTheme({ dark, background: selectedTheme.colors.chrome, symbol: selectedTheme.colors.ink }))
  }, [dark, selectedTheme, run])

  useEffect(() => { run(() => desktop.setSpellcheck?.(settings.spellcheck)) }, [settings.spellcheck, run])
  useEffect(() => { run(() => desktop.setHotkeys?.(nativeShortcutOverrides(settings.hotkeys))) }, [settings.hotkeys, run])
  useEffect(() => { run(() => desktop.setMenuShortcutsIgnored?.(modalOpen)) }, [modalOpen, run])
  useEffect(() => { run(() => desktop.setRemoteMedia?.(settings.remoteMedia)) }, [settings.remoteMedia, run])
  useEffect(() => {
    document.title = active ? active.name + ' — 素笺' : '素笺'
    setSelection('')
  }, [active?.id, active?.name])
  useEffect(() => {
    if (requestedJump.current?.id === active?.id && active) {
      const { line } = requestedJump.current
      requestedJump.current = null
      requestAnimationFrame(() => editor.current?.jump(line))
    }
  }, [active?.id, mode])

  function setMode(next) {
    if (!active) return
    editor.current?.getValue()
    if (next === 'live' && active.text.length > MAX_LIVE_LENGTH) {
      setDialog({ type: 'large-file', id: active.id })
      return
    }
    amend(active.id, { mode: next })
  }

  function openFolder() {
    return run(async () => {
      const path = await desktop.openFolder?.()
      if (!path) return
      configure({ workspace: path })
      setSidebar('files')
      setRefresh(previous => previous + 1)
      if (!settings.sidebar) configure({ sidebar: true })
    })
  }

  function closeTab(id) {
    const doc = docs.find(item => item.id === id)
    const value = active?.id === id ? flushEditor() : doc?.text
    if (doc && value !== doc.savedText) setDialog({ type: 'close', id, name: doc.name })
    else run(() => workspace.close(id))
  }

  const resolveImage = useCallback(source => {
    if (/^(?:https?:|\/\/)/i.test(source) && !settings.remoteMedia) return null
    return desktop.resolveImage?.({ documentPath: active?.path, source, rootPath: settings.imageRoot }) ?? source
  }, [active?.path, settings.imageRoot, settings.remoteMedia])

  const embeddedImage = useCallback(source => {
    if (/^(?:https?:|\/\/)/i.test(source) && !settings.remoteMedia) return null
    return desktop.resolveImage?.({ documentPath: active?.path, source, rootPath: settings.imageRoot, embed: true }) ?? source
  }, [active?.path, settings.imageRoot, settings.remoteMedia])

  const assetUrl = useCallback(source => {
    if (/^(?:https?:|\/\/)/i.test(source) && !settings.remoteMedia) return ''
    return desktop.assetUrl?.(active?.path, source, settings.imageRoot) ?? source
  }, [active?.path, settings.imageRoot, settings.remoteMedia])

  function jump(line, doc = active) {
    if (!doc || !line) return
    if (doc.id === active?.id) editor.current?.jump(line)
    else requestedJump.current = { id: doc.id, line }
  }

  function jumpToSource(line, doc) {
    if (!doc || !line) return
    const targetMode = workspace.getDocument(doc.id)?.mode ?? settings.mode
    if (doc.id === activeId.current && targetMode === 'source') {
      editor.current?.jump(line)
    } else {
      requestedJump.current = { id: doc.id, line }
      amend(doc.id, { mode: 'source' })
    }
  }

  function followLink(href) {
    return run(async () => {
      if (/^(?:https?:|mailto:|\/\/)/i.test(href)) {
        await desktop.openExternal(href.startsWith('//') ? 'https:' + href : href)
        return
      }
      if (/^[a-z][a-z+.-]+:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) return
      const { target, anchor } = resolveLink(active?.path, href)
      if (!target || !native) return
      flushEditor()
      const next = await workspace.openPath(target)
      if (!anchor) return
      const heading = headings(next.text).find(item => slug(item.title) === slug(anchor))
      if (heading) jump(heading.line, next)
      else jumpToSource(sourceLine(anchor), next)
    })
  }

  function insertImages(files = []) {
    return run(async () => {
      if (!active) return
      const selectedDoc = active
      const inputs = files.length ? files : [null]
      for (const file of inputs) {
        const item = await desktop.importImage({
          documentPath: selectedDoc.path || undefined, assetFolder: settings.imageFolder || undefined,
          ...(file ? { bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name } : {}),
        })
        if (!item) continue
        const alt = file?.name?.replace(/\.[^.]+$/, '') ?? '图片'
        if (selectedDoc.id === activeId.current) editor.current?.command('image', { src: item.markdownPath, alt })
        else amend(selectedDoc.id, doc => ({ text: doc.text + '\n\n![' + alt.replace(/[[\]]/g, '') + '](' + item.markdownPath + ')\n' }))
      }
      setRefresh(previous => previous + 1)
    })
  }

  function openDroppedFiles(event) {
    const files = [...event.dataTransfer.files].filter(file => !file.type.startsWith('image/'))
    if (!files.length) return
    event.preventDefault()
    event.stopPropagation()
    flushEditor()
    run(async () => {
      for (const file of files) {
        const path = desktop.filePath?.(file)
        if (path) await workspace.openPath(path)
        else if (/\.(?:md|markdown|mdown|mkd|txt)$/i.test(file.name)) {
          const text = await file.text()
          workspace.add({ name: file.name, text, savedText: text })
        }
      }
    })
  }

  function command(name, payload) {
    if (!active) return
    if (mode === 'read') { notify('切换到编辑模式后即可修改。'); return }
    if (name === 'link' && !payload) {
      setDialog({ type: 'link', label: editor.current?.getSelection() || '' })
      return
    }
    if (name === 'table' && !payload) {
      setDialog({ type: 'table' })
      return
    }
    editor.current?.command(name, payload)
  }

  async function exportFile(format, options) {
    if (!active) return false
    const text = flushEditor() ?? active.text
    const html = visualExports.has(format) ? await renderDocument(text, {
      title: active.name, styled: format !== 'html-plain', theme: renderTheme, resolveImage: embeddedImage,
      allowRemoteMedia: settings.remoteMedia, print: format === 'pdf' || format === 'print',
      typography: { fontSize: settings.fontSize, lineHeight: settings.lineHeight },
    }) : undefined
    const result = await desktop.exportDocument({
      format, html, text, documentPath: active.path, defaultName: active.name,
      options: { ...options, imageRoot: settings.imageRoot, css: settings.customCss },
    })
    if (!result) return false
    if (result.path) notify('已导出 ' + leaf(result.path))
    return true
  }

  function openReview(doc, initialCandidate) {
    if (!doc) return
    const currentText = activeId.current === doc.id ? flushEditor() : undefined
    setDialog({
      type: 'review', docId: doc.id, baseText: currentText ?? doc.text,
      expectedPath: doc.path, initialCandidate, requestId: crypto.randomUUID(),
    })
  }

  async function applyReview({ expectedText, text }) {
    if (activeId.current === dialog.docId) flushEditor()
    const changed = await workspace.replaceReviewedText(dialog.docId, {
      expectedText, expectedPath: dialog.expectedPath, text,
    })
    if (changed) {
      setDialog(previous => previous?.requestId === dialog.requestId ? null : previous)
      notify('已采纳修订。可在「文档与视图」撤销本次审阅。')
    }
    return changed
  }

  function undoReview() {
    if (!active?.reviewUndo) return
    flushEditor()
    const { before, after } = active.reviewUndo
    run(async () => {
      await workspace.replaceReviewedText(active.id, { expectedText: after, expectedPath: active.path, text: before, undo: true })
      notify('已撤销本次审阅')
    })
  }

  const commandHandler = useRef(null)
  const handlingCommand = useRef(false)
  commandHandler.current = async request => {
    if (!request) return
    flushEditor()
    const doc = await workspace.openPath(request.path)
    if (request.kind === 'review') openReview(doc, request.candidate)
    else if (request.line) jumpToSource(request.line, doc)
  }

  useEffect(() => {
    if (!ready || !desktop.initialCommand) return
    let live = true
    let initialized = false
    const incoming = []
    const enqueue = requests => {
      const commands = requests.filter(Boolean)
      if (live && commands.length) setCommandQueue(previous => [...previous, ...commands])
    }
    const unsubscribe = desktop.onCommand?.(request => {
      if (initialized) enqueue([request])
      else incoming.push(request)
    })
    const initialize = async () => {
      let first
      try { first = await desktop.initialCommand() } catch (error) {
        if (live) notify(error.message, true)
      }
      initialized = true
      enqueue([first, ...incoming])
      incoming.length = 0
    }
    void initialize()
    return () => { live = false; unsubscribe?.() }
  }, [ready, notify])

  useEffect(() => {
    if (dialog || !commandQueue.length || handlingCommand.current) return
    handlingCommand.current = true
    const processCommand = async () => {
      try {
        await commandHandler.current(commandQueue[0])
      } catch (error) {
        notify(error.message, true)
      } finally {
        handlingCommand.current = false
        setCommandQueue(previous => previous.slice(1))
      }
    }
    void processCommand()
  }, [commandQueue, dialog, notify])

  function action(key) {
    switch (key) {
      case 'new-file': flushEditor(); workspace.add(); break
      case 'new-window': run(() => desktop.newWindow?.()); break
      case 'open-files': flushEditor(); run(workspace.openFiles); break
      case 'open-folder': openFolder(); break
      case 'save': case 'save-as': flushEditor(); if (active) run(() => workspace.save(active.id, { saveAs: key === 'save-as' })); break
      case 'review': openReview(active); break
      case 'undo-review': undoReview(); break
      case 'workflow-templates': setDialog({ type: 'workflow-templates' }); break
      case 'spec-check': flushEditor(); setDialog({ type: 'spec-check' }); break
      case 'source-link':
        if (mode === 'read') notify('切换到编辑模式后即可插入来源。')
        else if (active?.path) setDialog({ type: 'source-link', docId: active.id })
        else notify('请先保存当前文档，再插入相对来源链接。')
        break
      case 'close-tab': if (active) closeTab(active.id); break
      case 'reopen-tab': run(workspace.reopen); break
      case 'command-palette': setDialog({ type: 'command-palette' }); break
      case 'go-to-line': if (active) setDialog({ type: 'go-to-line', docId: active.id, text: flushEditor() ?? active.text }); break
      case 'next-tab': case 'previous-tab': {
        if (docs.length < 2) break
        flushEditor()
        const index = docs.findIndex(doc => doc.id === active?.id)
        const next = (index + docs.length + (key === 'next-tab' ? 1 : -1)) % docs.length
        workspace.select(docs[next].id)
        requestAnimationFrame(() => editor.current?.focus())
        break
      }
      case 'quick-open': setDialog({ type: 'quick' }); break
      case 'find': case 'replace': {
        if (!active) break
        if (findControl.current) findControl.current.open(key === 'replace')
        else setFindState({ query: editor.current?.getSelection().split('\n')[0], replace: key === 'replace', id: Date.now() })
        break
      }
      case 'search-folder': setDialog({ type: 'search-folder' }); break
      case 'settings': case 'shortcuts': setDialog({ type: 'settings', panel: key === 'shortcuts' ? 'shortcuts' : 'appearance' }); break
      case 'view-live': setMode('live'); break
      case 'view-source': setMode(mode === 'source' ? 'live' : 'source'); break
      case 'view-split': setMode('split'); break
      case 'view-read': setMode(mode === 'read' ? 'live' : 'read'); break
      case 'toggle-sidebar': configure({ sidebar: !settings.sidebar }); break
      case 'toggle-focus': configure({ focusMode: !settings.focusMode }); break
      case 'toggle-typewriter': configure({ typewriter: !settings.typewriter }); break
      case 'toggle-dark': configure({ theme: dark ? 'paper' : 'dark' }); break
      case 'fullscreen': run(() => desktop.toggleFullscreen()); break
      case 'pin-folder': if (settings.workspace && !settings.pinned.includes(settings.workspace)) configure({ pinned: [...settings.pinned, settings.workspace] }); break
      case 'image':
        if (mode === 'read') notify('切换到编辑模式后即可插入图片。')
        else insertImages()
        break
      case 'upload-images': {
        if (!active || !desktop.uploadImages) break
        if (!settings.uploader.trim()) {
          setDialog({ type: 'settings', panel: 'files' })
          notify('请填写图片上传程序。')
          break
        }
        const sources = localImageSources(flushEditor() ?? active.text)
        if (!sources.length) { notify('文档中没有可上传的本地图片。'); break }
        setDialog({ type: 'upload-images', sources })
        break
      }
      case 'copy-markdown':
        run(() => desktop.writeClipboard({ text: editor.current?.getSelection() || flushEditor() || '' }))
        break
      case 'copy-rich': case 'copy-html': case 'copy-plain':
        run(async () => {
          const text = editor.current?.getSelection() || flushEditor() || ''
          const html = await renderDocument(text, { resolveImage: embeddedImage, allowRemoteMedia: settings.remoteMedia })
          const plain = new DOMParser().parseFromString(html, 'text/html').body.textContent
          await desktop.writeClipboard(key === 'copy-html' ? { text: html } : key === 'copy-plain' ? { text: plain } : { text: plain, html })
          notify('已复制')
        })
        break
      case 'import':
        run(async () => {
          const doc = await desktop.importDocument?.()
          if (doc) workspace.add(doc)
        })
        break
      case 'export': if (active) setDialog({ type: 'export' }); break
      case 'print': run(() => exportFile('print')); break
      default: break
    }
  }

  const actionRef = useRef(action)
  actionRef.current = action
  const modalRef = useRef(modalOpen)
  modalRef.current = modalOpen
  useEffect(() => desktop.onMenuAction?.(key => {
    if (!modalRef.current) actionRef.current(key)
  }), [])
  useEffect(() => {
    function shortcut(event) {
      if (isComposingKey(event) || modalOpen || event.defaultPrevented || event.repeat) return
      if (event.key === 'F3' && !event.ctrlKey && !event.metaKey && !event.altKey && findControl.current) {
        event.preventDefault()
        findControl.current.next(event.shiftKey)
        return
      }
      const id = findShortcut(event, { hotkeys: settings.hotkeys, platform: desktop.platform, native, modalOpen })
      if (!id || !canRunCommand(commandsById.get(id), commandContext.current)) return
      event.preventDefault()
      actionRef.current(id)
    }
    document.addEventListener('keydown', shortcut, true)
    return () => document.removeEventListener('keydown', shortcut, true)
  }, [settings.hotkeys, modalOpen])

  useEffect(() => {
    if (!context) return
    const dismiss = () => setContext(null)
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismiss)
    }
  }, [context])

  function contextAction(key) {
    const item = context.item
    setContext(null)
    if (key === 'rename' || key === 'trash' || key === 'mkdir' || key === 'move') setDialog({ type: key, item })
    if (key === 'open') run(() => desktop.showItemInFolder(item.path))
    if (key === 'duplicate') run(async () => { await desktop.duplicatePath(item.path); setRefresh(previous => previous + 1) })
    if (key === 'undo') run(async () => { await desktop.undoFileOperation(); setRefresh(previous => previous + 1) })
    if (key === 'pin' && !settings.pinned.includes(item.path)) configure({ pinned: [...settings.pinned, item.path] })
  }

  function submitPath(key, value) {
    const item = dialog.item
    return run(async () => {
      const next = key === 'rename' ? await desktop.renamePath(item.path, value) :
        key === 'move' ? await desktop.movePath(item.path, value) : await desktop.createDirectory(item.path, value)
      if (key !== 'mkdir') for (const doc of docs) {
        if (doc.path === item.path) amend(doc.id, { path: next, name: leaf(next) })
        else if (item.kind === 'directory' && (doc.path?.startsWith(item.path + '/') || doc.path?.startsWith(item.path + '\\'))) {
          amend(doc.id, { path: next + doc.path.slice(item.path.length) })
        }
      }
      setRefresh(previous => previous + 1)
      closeDialog()
    })
  }

  return <div className={'application platform-' + desktop.platform + (settings.sidebar ? ' with-sidebar' : '')}
    style={{
      '--document-width': settings.width + 'px', '--document-font-size': settings.fontSize + 'px',
      '--document-line-height': settings.lineHeight,
    }}
    data-ready={ready}>
    <style>{fontsCss}</style>
    {settings.customCss && <style>{settings.customCss}</style>}
    <header className="titlebar">
      <div className="brand"><FileText size={21} strokeWidth={1.8}/><span>素笺</span></div>
    </header>
    <div className="workbench">
      {settings.sidebar && <Sidebar workspace={workspace} sidebar={sidebar} setSidebar={setSidebar} outline={outline}
        jump={jump} openFolder={openFolder} searchFolder={() => action('search-folder')} refresh={refresh} notify={notify}
        openRecovery={() => setDialog({ type: 'recovery' })} onContext={(event, item) => {
          event.preventDefault()
          setContext({ x: Math.min(event.clientX, innerWidth - 180), y: Math.min(event.clientY, innerHeight - 270), item })
        }}/>}
      <main className="work-area" onDragOver={event => {
        if ([...event.dataTransfer.types].includes('Files')) event.preventDefault()
      }} onDrop={openDroppedFiles}>
        <div className="topline">
          <TabStrip docs={docs} active={active} isDirty={isDirty} onSelect={id => { flushEditor(); workspace.select(id) }}
            onClose={closeTab} onNew={() => action('new-file')} plus={Plus}/>
          <Toolbar active={active} mode={mode} setMode={setMode} action={action} command={command} settings={settings} native={native} platform={desktop.platform}
            canUndoReview={canUndoReview}/>
        </div>
        {findState && active && <FindBar key={findState.id} initial={findState} controlRef={findControl} close={() => { setFindState(null); editor.current?.focus() }}
          find={(query, options) => editor.current?.find(query, options)} replace={(query, value, options) => editor.current?.replace(query, value, options) ?? 0}/>}
        {active?.conflict && <div className="conflict" role="status">
          <AlertTriangle size={16}/><span>{active.conflict.document ? '磁盘上的文件已更改' : '磁盘上的文件已移动或删除'}</span>
          <button onClick={() => setDialog({ type: 'conflict' })}>处理冲突 <ChevronDown size={13}/></button>
        </div>}
        {active?.text.length > MAX_LIVE_LENGTH && mode === 'source' && <div className="large-note">已为长文档启用源码编辑 <button onClick={() => setMode('live')}>切换到即时渲染</button></div>}
        {active && (
          <div id="write" className="editor-frame" role="tabpanel" aria-labelledby={'doc-tab-' + active.id}>
            <Editor docId={active.id} value={active.text} mode={mode} editorRef={editor}
              onChange={text => amend(active.id, { text })} onSelection={setSelection} onLink={followLink} onImage={insertImages}
              assetUrl={assetUrl} resolveImage={resolveImage} theme={renderTheme}
              wrap={settings.wrap} allowRemoteMedia={settings.remoteMedia}
              focusMode={settings.focusMode} typewriter={settings.typewriter} spellcheck={settings.spellcheck}/>
          </div>
        )}
        {!active && <div className="empty-workspace"><BookOpen size={32} strokeWidth={1.25}/><h1>打开或新建文档</h1>
          <div><button className="primary" onClick={() => action('new-file')}><Plus size={16}/> 新建文档</button>
            <button onClick={() => action('open-files')}><FolderOpen size={16}/> 打开文档</button></div>
        </div>}
      </main>
    </div>
    <footer className="statusbar">
      <div>{active ? <><CircleCheck size={15}/><span>{workspace.saving === active.id ? '正在保存' : isDirty(active) ? '有未保存的改动' : active.path ? '已保存' : active.example ? '写作手册' : '新文档'}</span></> : <span>无打开的文档</span>}</div>
      <div>{workspace.recoverable.length > 0 && !settings.sidebar && <button onClick={() => setDialog({ type: 'recovery' })}>恢复草稿</button>}
        {active && <><span>{selection ? '选中 ' + wordCount(selection) + ' / ' : '字数 '} {words}</span><span className="status-rule"/><span>{active.encoding?.toUpperCase() || 'UTF-8'} / Markdown</span></>}</div>
    </footer>
    {message && <div className={'toast ' + (message.error ? 'error' : '')} role={message.error ? 'alert' : 'status'}>
      {message.error ? <AlertTriangle size={17}/> : <CircleCheck size={17}/>} {message.text}
    </div>}
    {reviewDoc && <Suspense fallback={null}>
      <ReviewDialog key={dialog.requestId} name={reviewDoc.name} baseText={dialog.baseText} currentText={reviewDoc.text}
        diskText={reviewDoc.conflict?.document?.text ?? null} diskConflict={!!reviewDoc.conflict}
        initialCandidate={dialog.initialCandidate}
        compareGit={reviewDoc.path && desktop.readGitBaseline ? ref => desktop.readGitBaseline({ documentPath: reviewDoc.path, ref }) : undefined}
        chooseCandidate={desktop.chooseReviewCandidate} copyBase={text => desktop.writeClipboard({ text })} theme={renderTheme}
        onApply={applyReview} onClose={closeDialog}/>
    </Suspense>}
    {dialog?.type === 'workflow-templates' && <TemplatesDialog onClose={closeDialog} onCreate={index => {
      flushEditor()
      for (const document of workflowTemplates[index].documents) workspace.add(document)
      closeDialog()
    }}/>}
    {dialog?.type === 'spec-check' && <SpecCheckDialog documents={docs} onClose={closeDialog} onJump={(id, line) => {
      const doc = workspace.getDocument(id)
      if (!doc) return
      closeDialog()
      workspace.select(id)
      jumpToSource(line, doc)
    }}/>}
    {dialog?.type === 'source-link' && active?.id === dialog.docId &&
      <SourceLinkDialog document={active} documents={docs} onClose={closeDialog} onInsert={value => {
        closeDialog()
        const id = active.id
        requestAnimationFrame(() => { if (activeId.current === id) command('link', value) })
      }}/>}
    {dialog?.type === 'settings' && <Settings settings={settings} configure={configure} close={closeDialog} native={native}
      fonts={fonts} initialPanel={dialog.panel}/>}
    {dialog?.type === 'quick' && <QuickOpen workspace={workspace} onClose={closeDialog} notify={notify}/>}
    {dialog?.type === 'command-palette' && <CommandPalette active={active} mode={mode} settings={settings} native={native}
      canUndoReview={canUndoReview} tabCount={docs.length} platform={desktop.platform} onAction={action} onClose={closeDialog}/>}
    {dialog?.type === 'go-to-line' && <GoToLine text={dialog.text} onClose={closeDialog} onJump={line => {
      const doc = workspace.getDocument(dialog.docId)
      closeDialog()
      requestAnimationFrame(() => { if (doc?.id === activeId.current) jumpToSource(line, doc) })
    }}/>}
    {dialog?.type === 'search-folder' && <FolderSearch path={settings.workspace} close={closeDialog} notify={notify}
      jump={(path, line) => run(async () => { flushEditor(); const next = await workspace.openPath(path); jump(line, next); closeDialog() })}/>}
    {dialog?.type === 'export' && active && <ExportDialog name={active.name} close={closeDialog} run={exportFile}/>}
    {dialog?.type === 'upload-images' && active && <Modal title="上传本地图片" onClose={closeDialog}>
      <p className="modal-detail">将使用设置中的程序上传 {dialog.sources.length} 张图片，并替换文档中的图片地址。</p>
      <footer><button onClick={closeDialog}>取消</button>
        <button className="primary" onClick={() => {
          const doc = active
          const { sources } = dialog
          closeDialog()
          run(async () => {
            const replacements = await desktop.uploadImages({
              documentPath: doc.path, sources, rootPath: settings.imageRoot, executable: settings.uploader.trim(),
              args: settings.uploaderArgs.split(/\r?\n/).map(arg => arg.trim()).filter(Boolean),
            })
            amend(doc.id, item => ({ text: updateImageSources(item.text, replacements) }))
            notify('已更新 ' + replacements.length + ' 张图片的地址')
          })
        }}>上传并更新地址</button></footer>
    </Modal>}
    {dialog?.type === 'recovery' && <Recovery drafts={workspace.recoverable} close={closeDialog} recover={workspace.recover} notify={notify}
      discard={draft => setDialog({ type: 'discard-recovery', draft })}/>}
    {dialog?.type === 'discard-recovery' && <Modal title="删除恢复草稿？" onClose={closeDialog}>
      <p className="modal-detail">{dialog.draft.name}</p><footer><button onClick={() => setDialog({ type: 'recovery' })}>取消</button>
        <button className="danger" onClick={() => run(async () => { await workspace.removeRecovery(dialog.draft.id); setDialog({ type: 'recovery' }) })}>删除草稿</button></footer>
    </Modal>}
    {dialog?.type === 'close' && <Modal title="保存更改？" onClose={closeDialog}>
      <p className="modal-detail">{dialog.name}</p><footer><button onClick={closeDialog}>取消</button>
        <button onClick={() => run(async () => { await workspace.close(dialog.id, 'discard'); closeDialog() })}>放弃更改</button>
        <button className="primary" onClick={() => run(async () => { await workspace.close(dialog.id, 'save'); closeDialog() })}>保存</button></footer>
    </Modal>}
    {dialog?.type === 'conflict' && active?.conflict && <Modal title="文件发生冲突" onClose={closeDialog}>
      <p className="modal-detail">保留编辑中的版本为新文件，或者处理磁盘上的版本。</p>
      {active.conflict.document && <pre className="conflict-preview">{active.conflict.document.text.slice(0, 4000)}</pre>}
      <footer>
        {active.conflict.document && <><button onClick={() => run(async () => { await workspace.resolveConflict(active.id, 'reload'); closeDialog() })}>读取磁盘版本</button>
          <button onClick={() => run(async () => { if (await workspace.resolveConflict(active.id, 'overwrite')) closeDialog() })}>覆盖磁盘版本</button></>}
        <button className="primary" onClick={() => run(async () => { if (await workspace.resolveConflict(active.id, 'copy')) closeDialog() })}>另存副本</button>
      </footer>
    </Modal>}
    {dialog?.type === 'large-file' && <Modal title="启用即时渲染？" onClose={closeDialog}>
      <p className="modal-detail">长文档在源码模式下使用虚拟滚动。即时渲染可能需要更多时间。</p>
      <footer><button onClick={closeDialog}>继续编辑源码</button><button className="primary" onClick={() => { amend(dialog.id, { mode: 'live' }); closeDialog() }}>启用即时渲染</button></footer>
    </Modal>}
    {dialog?.type === 'link' && <Modal title="插入链接" onClose={closeDialog}>
      <form onSubmit={event => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        closeDialog()
        requestAnimationFrame(() => command('link', { href: data.get('href'), label: data.get('label') }))
      }}>
        <label className="text-setting">文字<input name="label" defaultValue={dialog.label} placeholder="链接"/></label>
        <label className="text-setting">地址<input name="href" autoFocus required placeholder="https:// 或相对路径"/></label>
        <footer><button type="button" onClick={closeDialog}>取消</button><button type="submit" className="primary">插入</button></footer>
      </form>
    </Modal>}
    {dialog?.type === 'table' && <Modal title="插入表格" onClose={closeDialog}>
      <form onSubmit={event => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        closeDialog()
        requestAnimationFrame(() => command('table', { columns: +data.get('columns'), rows: +data.get('rows') }))
      }}>
        <label className="setting"><span>列数</span><input type="number" name="columns" min="2" max="20" defaultValue="3" required/></label>
        <label className="setting"><span>数据行数</span><input type="number" name="rows" min="1" max="20" defaultValue="2" required/></label>
        <footer><button type="button" onClick={closeDialog}>取消</button><button type="submit" className="primary">插入</button></footer>
      </form>
    </Modal>}
    {context && <div className="context-menu tool-menu-list" style={{ left: context.x, top: context.y }} onPointerDown={event => event.stopPropagation()}>
      {(context.item.kind === 'directory' ? [['mkdir','新建子文件夹'],['pin','固定文件夹']] : []).concat([
        ['rename','重命名'], ['move','移动到…'], ['duplicate','复制'], ['trash','移到回收站'], ['open','在文件管理器中显示'], ['undo','撤销文件操作'],
      ]).map(([key, name]) => <button key={key} onClick={() => contextAction(key)}>{name}</button>)}
    </div>}
    {['rename', 'move', 'mkdir'].includes(dialog?.type) && <Modal title={{ rename: '重命名', move: '移动到文件夹', mkdir: '新建子文件夹' }[dialog.type]} onClose={closeDialog}>
      <form onSubmit={event => { event.preventDefault(); submitPath(dialog.type, new FormData(event.currentTarget).get('name')) }}>
        <label className="text-setting">{dialog.type === 'move' ? '目标文件夹的完整路径' : '名称'}
          <input name="name" required autoFocus defaultValue={dialog.type === 'rename' ? dialog.item.name : ''}/></label>
        <footer><button type="button" onClick={closeDialog}>取消</button><button type="submit" className="primary">确定</button></footer>
      </form>
    </Modal>}
    {dialog?.type === 'trash' && <Modal title="移到回收站？" onClose={closeDialog}>
      <p className="modal-detail">{dialog.item.name}</p><footer><button onClick={closeDialog}>取消</button>
        <button className="danger" onClick={() => run(async () => {
          await desktop.trashPath(dialog.item.path); setRefresh(previous => previous + 1); closeDialog()
        })}>移到回收站</button></footer>
    </Modal>}
  </div>
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { desktop } from './desktop.js'
import { guide } from './example.js'
import { MAX_LIVE_LENGTH } from './text.js'
import { FONT_DEFAULTS } from './fonts.js'

export const defaults = {
  theme: 'paper', mode: 'live', sidebar: true, fontSize: 17, lineHeight: 1.68, width: 790, focusMode: false,
  typewriter: false, proseSpellcheck: false, autoSave: false, resume: true, wrap: true,
  workspace: null, recent: [], pinned: [], openPaths: [], customCss: '', imageFolder: '',
  imageRoot: '', uploader: '', uploaderArgs: '', fileList: false, fileSort: 'name', showHidden: false, remoteMedia: false, hotkeys: {},
  ...FONT_DEFAULTS,
}

function createDoc(fields = {}) {
  const { mode, ...file } = fields
  return {
    id: crypto.randomUUID(), name: '未命名.md', text: '', savedText: '', path: null,
    ...file, mode: mode ?? (file.text?.length > MAX_LIVE_LENGTH ? 'source' : null),
  }
}

const example = () => createDoc({ id: 'guide', name: '写作手册.md', text: guide, savedText: guide, example: true })
const fromDisk = file => createDoc({ ...file, savedText: file.text })
export const isDirty = doc => !!doc && doc.text !== doc.savedText
const asDraft = doc => ({ id: doc.id, path: doc.path, name: doc.name, text: doc.text, expectedHash: doc.hash, savedText: doc.savedText })
const fileKey = path => desktop.platform === 'win32' ? path?.toLowerCase() : path

export function useWorkspace(notify, beforeClose) {
  const [state, setState] = useState({ docs: [example()], activeId: 'guide' })
  const stateRef = useRef(state)
  const [settings, setSettings] = useState(defaults)
  const [ready, setReady] = useState(false)
  const [recoverable, setRecoverable] = useState([])
  const [saving, setSaving] = useState(null)
  const settingsRef = useRef(settings)
  const closed = useRef([])
  const pendingSaves = useRef(new Map())
  const draftTasks = useRef(new Map())
  const writtenDrafts = useRef(new Map())
  const closing = useRef(new Set())
  const serializedPreferences = useRef(Promise.resolve())

  const commit = useCallback(update => {
    const next = update(stateRef.current)
    if (next !== stateRef.current) {
      stateRef.current = next
      setState(next)
    }
  }, [])

  const configure = useCallback(patch => {
    const next = { ...settingsRef.current, ...(typeof patch === 'function' ? patch(settingsRef.current) : patch) }
    settingsRef.current = next
    setSettings(next)
  }, [])

  const amend = useCallback((id, patch) => {
    commit(previous => ({
      ...previous,
      docs: previous.docs.map(doc => doc.id === id ? { ...doc, ...(typeof patch === 'function' ? patch(doc) : patch) } : doc),
    }))
  }, [commit])

  const select = useCallback(id => commit(previous => previous.activeId === id ? previous : { ...previous, activeId: id }), [commit])

  const recordRecent = useCallback(paths => {
    const unique = paths.filter(Boolean)
    if (!unique.length) return
    configure(previous => ({
      recent: [...new Map([...unique, ...previous.recent].map(path => [fileKey(path), path])).values()].slice(0, 30),
    }))
  }, [configure])

  const append = useCallback((docs, activate = true) => {
    if (!docs.length) return
    commit(previous => {
      const items = [...previous.docs]
      let activeId = previous.activeId
      for (const file of docs) {
        const existing = items.find(doc => doc.id === file.id || (file.path && fileKey(doc.path) === fileKey(file.path)))
        if (!existing) items.push(file)
        if (activate || activeId === null) activeId = existing?.id ?? file.id
      }
      return { docs: items, activeId }
    })
    recordRecent(docs.map(file => file.path))
  }, [commit, recordRecent])

  const add = useCallback(fields => {
    const doc = createDoc(fields)
    append([doc])
    return doc
  }, [append])

  const openFiles = useCallback(async () => {
    const files = await desktop.openFiles()
    append(files.map(fromDisk))
  }, [append])

  const getDocumentByPath = useCallback(path => path && stateRef.current.docs.find(doc => doc.path && fileKey(doc.path) === fileKey(path)), [])

  const openPath = useCallback(async (path, { activate = true } = {}) => {
    const current = getDocumentByPath(path)
    if (current) {
      if (activate) select(current.id)
      return current
    }
    const doc = fromDisk(await desktop.openPath(path))
    append([doc], activate)
    return getDocumentByPath(doc.path) ?? doc
  }, [append, getDocumentByPath, select])

  const getDocument = useCallback(id => stateRef.current.docs.find(doc => doc.id === id), [])

  const applyDiskChange = useCallback((path, document) => {
    const doc = stateRef.current.docs.find(item => fileKey(item.path) === fileKey(path))
    if (!doc || (document && doc.hash === document.hash)) return
    if (isDirty(doc) || !document) amend(doc.id, { conflict: { document } })
    else amend(doc.id, { ...document, savedText: document.text, conflict: null })
  }, [amend])

  const replaceReviewedText = useCallback(async (id, { expectedText, expectedPath, text, undo = false }) => {
    const check = () => {
      const doc = getDocument(id)
      if (!doc || doc.path !== expectedPath || doc.text !== expectedText) {
        throw new Error('当前文档已变动，请重新核对修订。')
      }
      if (doc.conflict || closing.current.has(id) || pendingSaves.current.has(id)) {
        throw new Error('文档正在保存、关闭或存在磁盘冲突，请处理后再试。')
      }
      return doc
    }
    const before = check()
    if (before.path && desktop.readReviewSnapshot) {
      const disk = await desktop.readReviewSnapshot(before.path)
      const current = check()
      if (!disk || disk.hash !== current.hash) {
        applyDiskChange(current.path, disk)
        throw new Error('磁盘上的文档已变动，请重新核对修订。')
      }
    }
    if (expectedText === text) return false
    amend(id, { text, reviewUndo: undo ? null : { before: expectedText, after: text } })
    return true
  }, [amend, applyDiskChange, getDocument])

  const runDraft = useCallback((id, work) => {
    const queue = (draftTasks.current.get(id) ?? Promise.resolve()).catch(() => {}).then(work)
    draftTasks.current.set(id, queue)
    const forget = () => { if (draftTasks.current.get(id) === queue) draftTasks.current.delete(id) }
    queue.then(forget, forget)
    return queue
  }, [])

  const writeDraft = useCallback(doc => {
    const snapshot = asDraft(doc)
    return runDraft(doc.id, async () => {
      if (closing.current.has(doc.id)) return
      if (isDirty(doc)) {
        const fingerprint = JSON.stringify(snapshot)
        if (writtenDrafts.current.get(doc.id) === fingerprint) return
        await desktop.saveDraft(snapshot)
        writtenDrafts.current.set(doc.id, fingerprint)
      } else if (writtenDrafts.current.has(doc.id)) {
        await desktop.deleteDraft(doc.id)
        writtenDrafts.current.delete(doc.id)
      }
    })
  }, [runDraft])

  const discardDraft = useCallback(id => runDraft(id, async () => {
    await desktop.deleteDraft(id)
    writtenDrafts.current.delete(id)
  }), [runDraft])

  const persistDrafts = useCallback(() => Promise.all(stateRef.current.docs.map(writeDraft)), [writeDraft])

  const save = useCallback((id, options = {}) => {
    const previous = pendingSaves.current.get(id) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(async () => {
      const current = stateRef.current.docs.find(doc => doc.id === id)
      if (!current) return false
      if (current.path && !options.saveAs && !options.force && !isDirty(current)) return true
      const path = options.saveAs ? undefined : current.path || undefined
      setSaving(id)
      try {
        const result = await desktop.saveFile({
          path, text: current.text, expectedHash: path ? options.expectedHash ?? current.hash : undefined,
          defaultName: current.name, force: options.force,
        })
        if (result.status === 'canceled') return false
        if (result.status === 'conflict') {
          amend(id, { conflict: { document: result.document ?? null } })
          return false
        }
        const { text, ...file } = result.document
        amend(id, doc => ({
          ...file, savedText: text, text: doc.text === current.text ? text : doc.text,
          conflict: null, example: false,
        }))
        const saved = stateRef.current.docs.find(doc => doc.id === id)
        if (saved) await writeDraft(saved)
        recordRecent([file.path])
        if (!options.quiet) notify('已保存')
        return true
      } finally {
        setSaving(value => value === id ? null : value)
      }
    })
    pendingSaves.current.set(id, task)
    const forget = () => { if (pendingSaves.current.get(id) === task) pendingSaves.current.delete(id) }
    task.then(forget, forget)
    return task
  }, [amend, notify, recordRecent, writeDraft])

  const close = useCallback(async (id, disposition) => {
    const doc = stateRef.current.docs.find(item => item.id === id)
    if (!doc) return
    if (disposition === 'save' && !await save(id)) return
    const current = stateRef.current.docs.find(item => item.id === id)
    if (!current || (disposition === 'save' && isDirty(current))) return
    if (isDirty(current) && disposition !== 'discard') return
    closing.current.add(id)
    try { await discardDraft(id) } catch (error) {
      closing.current.delete(id)
      throw error
    }
    closed.current.push({ ...current, text: current.savedText, conflict: null, reviewUndo: null })
    if (closed.current.length > 30) closed.current.shift()
    commit(previous => {
      const index = previous.docs.findIndex(item => item.id === id)
      const docs = previous.docs.filter(item => item.id !== id)
      return { docs, activeId: previous.activeId === id ? docs[Math.max(index - 1, 0)]?.id ?? null : previous.activeId }
    })
    closing.current.delete(id)
  }, [commit, discardDraft, save])

  const reopen = useCallback(async () => {
    const doc = closed.current.pop()
    if (doc?.path) await openPath(doc.path)
    else if (doc) append([doc])
  }, [append, openPath])

  const resolveConflict = useCallback(async (id, choice) => {
    const doc = stateRef.current.docs.find(item => item.id === id)
    if (!doc?.conflict) return
    if (choice === 'copy') return save(id, { saveAs: true })
    if (choice === 'overwrite') {
      const hash = doc.conflict.document?.hash
      if (hash) return save(id, { expectedHash: hash })
      return save(id, { saveAs: true })
    }
    if (choice === 'reload') {
      const disk = doc.conflict.document
      if (!disk) return
      amend(id, { ...disk, savedText: disk.text, conflict: null })
      await discardDraft(id)
    }
  }, [amend, discardDraft, save])

  const recover = useCallback(async id => {
    const draft = recoverable.find(item => item.id === id)
    if (!draft) return
    const disk = draft.path ? await desktop.openPath(draft.path).catch(() => null) : null
    const existing = disk ? stateRef.current.docs.find(doc => fileKey(doc.path) === fileKey(draft.path)) : null
    const doc = createDoc({
      ...disk, ...draft, savedText: disk?.text ?? draft.savedText ?? '',
      hash: draft.expectedHash, conflict: draft.path && draft.expectedHash !== disk?.hash ? { document: disk } : null,
    })
    if (existing && isDirty(existing)) {
      const copy = add({ ...doc, id: crypto.randomUUID(), path: null, hash: undefined, savedText: '', name: '恢复-' + doc.name, conflict: null })
      await writeDraft(copy)
      await discardDraft(id)
    } else if (existing) {
      commit(previous => ({ docs: previous.docs.map(item => item.id === existing.id ? doc : item), activeId: doc.id }))
    } else {
      append([doc])
    }
    writtenDrafts.current.set(id, '')
    setRecoverable(items => items.filter(item => item.id !== id))
  }, [add, append, commit, discardDraft, recoverable, writeDraft])

  useEffect(() => {
    let live = true
    const handle = error => { if (live) notify(error.message ?? String(error), true) }
    const init = async () => {
      const [prefs, drafts, initial] = await Promise.all([
        desktop.loadPreferences().catch(error => { handle(error); return {} }),
        desktop.loadDrafts().catch(error => { handle(error); return [] }),
        desktop.initialDocuments?.().catch(error => { handle(error); return [] }) ?? [],
      ])
      if (!live) return
      const saved = { ...prefs }
      // Earlier releases persisted the default-on value even without an opt-in.
      delete saved.spellcheck
      configure({ ...saved, proseSpellcheck: saved.proseSpellcheck === true })
      setRecoverable(Array.isArray(drafts) ? drafts : [])
      if (initial.length) {
        const docs = initial.map(fromDisk)
        commit(() => ({ docs, activeId: docs.at(-1).id }))
        recordRecent(docs.map(doc => doc.path))
      } else if (settingsRef.current.resume) {
        const restored = await Promise.all(settingsRef.current.openPaths.map(path => desktop.openPath?.(path).catch(() => null)))
        if (!live) return
        const docs = restored.filter(Boolean).map(fromDisk)
        if (docs.length && stateRef.current.activeId === 'guide') {
          commit(() => ({ docs, activeId: docs.at(-1).id }))
        }
      }
      setReady(true)
    }
    const stopOpen = desktop.onOpenFiles?.(files => append(files.map(fromDisk)))
    const stopChanges = desktop.onExternalChange?.(({ path, document }) => {
      const doc = stateRef.current.docs.find(item => fileKey(item.path) === fileKey(path))
      if (!doc) return
      const pending = pendingSaves.current.get(doc.id)
      if (pending) {
        pending.catch(() => {}).then(async () => {
          let latest
          try { latest = await desktop.openPath(path) } catch (error) {
            if (document) { notify(error.message, true); return }
            latest = null
          }
          if (live) applyDiskChange(path, latest)
        })
      } else applyDiskChange(path, document)
    })
    init().catch(error => { handle(error); if (live) setReady(true) })
    return () => { live = false; stopOpen?.(); stopChanges?.() }
  }, [append, applyDiskChange, commit, configure, notify, recordRecent])

  const paths = JSON.stringify(state.docs.map(doc => doc.path).filter(Boolean))
  useEffect(() => { desktop.setWatchedFiles(JSON.parse(paths)) }, [paths])

  useEffect(() => {
    if (!ready) return
    const snapshot = { ...settings, openPaths: JSON.parse(paths) }
    serializedPreferences.current = serializedPreferences.current.catch(() => {}).then(() => desktop.savePreferences(snapshot))
    serializedPreferences.current.catch(error => notify(error.message, true))
  }, [ready, settings, paths, notify])

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => persistDrafts().catch(error => notify(error.message, true)), 250)
    return () => clearTimeout(timer)
  }, [state.docs, ready, notify, persistDrafts])

  useEffect(() => {
    if (!ready || !settings.autoSave) return
    const timer = setTimeout(() => {
      for (const doc of stateRef.current.docs) {
        if (doc.path && isDirty(doc) && !doc.conflict) save(doc.id, { quiet: true }).catch(error => notify(error.message, true))
      }
    }, 1200)
    return () => clearTimeout(timer)
  }, [state.docs, ready, settings.autoSave, save, notify])

  useEffect(() => desktop.onBeforeClose?.(async () => {
    try {
      beforeClose()
      await Promise.allSettled(pendingSaves.current.values())
      await persistDrafts()
      await serializedPreferences.current
      await desktop.finishClose()
    } catch (error) {
      notify('草稿未写入，窗口保持打开。' + error.message, true)
      await desktop.cancelClose?.()
    }
  }), [beforeClose, notify, persistDrafts])

  return {
    docs: state.docs, active: state.docs.find(doc => doc.id === state.activeId), settings, ready, saving, recoverable,
    select, configure, add, append, amend, close, reopen, openFiles, openPath, getDocument, getDocumentByPath, replaceReviewedText, save, resolveConflict, recover,
    removeRecovery: async id => { await discardDraft(id); setRecoverable(items => items.filter(item => item.id !== id)) },
  }
}

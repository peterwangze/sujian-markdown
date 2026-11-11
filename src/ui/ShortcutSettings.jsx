import { useId, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { commandGroup, commandScore, configurableCommands, displayShortcut, effectiveShortcut, isComposingKey,
  normalizeShortcut, shortcutAssignmentError, shortcutFromEvent } from '../workspace/commands.js'
import './commands.css'

export function ShortcutSettings({ hotkeys, platform, onChange }) {
  const [query, setQuery] = useState('')
  const [edit, setEdit] = useState(null)
  const feedbackId = useId()
  const matches = useMemo(() => configurableCommands.filter(command => commandScore(command, query) >= 0), [query])
  const error = edit?.value ? shortcutAssignmentError(edit.id, edit.value, hotkeys, platform) : ''

  function save(event) {
    event.preventDefault()
    if (error || !edit?.value) return
    onChange({ ...hotkeys, [edit.id]: normalizeShortcut(edit.value) })
    setEdit(null)
  }

  function reset(id) {
    const next = { ...hotkeys }
    delete next[id]
    onChange(next)
    if (edit?.id === id) setEdit(null)
  }

  function record(event) {
    if (isComposingKey(event.nativeEvent)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setEdit(null)
      return
    }
    const value = shortcutFromEvent(event.nativeEvent, platform)
    if (!value) return
    event.preventDefault()
    event.stopPropagation()
    setEdit(previous => previous ? { ...previous, value } : previous)
  }

  return <div className="shortcut-settings">
    <div className="search-input">
      <Search size={16} aria-hidden="true"/>
      <input type="search" aria-label="搜索快捷键" placeholder="搜索快捷键" value={query}
        onChange={event => { setQuery(event.target.value); setEdit(null) }}/>
    </div>
    <div className="shortcut-settings-list">
      {matches.map(command => {
        const value = displayShortcut(effectiveShortcut(command, hotkeys, platform), platform)
        const isCustom = Boolean(hotkeys?.[command.id]?.trim?.())
        return <section className="shortcut-entry" key={command.id} aria-label={command.label}>
          <div className="shortcut-summary">
            <span>{command.label}<small>{commandGroup(command)}</small></span>
            {value ? <kbd>{value}</kbd> : <small>未设置</small>}
            {edit?.id !== command.id && <button type="button" aria-label={`设置${command.label}快捷键`}
              onClick={() => setEdit({ id: command.id, value: hotkeys?.[command.id] ?? '' })}>更改</button>}
            {isCustom && <button type="button" aria-label={`恢复${command.label}默认快捷键`} onClick={() => reset(command.id)}>恢复默认</button>}
          </div>
          {edit?.id === command.id && <form onSubmit={save}>
            <div className="shortcut-record">
              <input autoFocus aria-label={`${command.label}的新快捷键`} placeholder="按下组合键或输入 Ctrl+..."
                spellCheck={false} value={edit.value} aria-invalid={Boolean(error)} aria-describedby={error ? feedbackId : undefined}
                onChange={event => setEdit({ id: command.id, value: event.target.value })} onKeyDown={record}/>
              <button type="submit" className="primary" disabled={!edit.value || Boolean(error)}>保存</button>
              <button type="button" onClick={() => setEdit(null)}>取消</button>
            </div>
            {error && <p className="form-error" id={feedbackId} role="status">{error}</p>}
          </form>}
        </section>
      })}
      {!matches.length && <p className="sidebar-note" role="status">没有匹配的快捷键。</p>}
    </div>
  </div>
}

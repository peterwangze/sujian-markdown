import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { canRunCommand, commandGroup, commands, commandScore, displayShortcut, effectiveShortcut, isComposingKey } from '../workspace/commands.js'
import { Modal } from './Controls.jsx'
import './commands.css'

export function CommandPalette({ active, mode, settings, native, canUndoReview, tabCount, platform, onAction, onClose }) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const input = useRef(null)
  const list = useRef(null)
  const listId = useId()
  const matches = useMemo(() => commands
    .filter(command => command.id !== 'command-palette' && canRunCommand(command, { active, mode, settings, native, canUndoReview, tabCount }))
    .map(command => ({ command, score: commandScore(command, query) }))
    .filter(item => item.score >= 0)
    .sort((first, second) => second.score - first.score)
    .map(item => item.command), [active, mode, settings, native, canUndoReview, tabCount, query])
  const index = Math.max(0, matches.findIndex(command => command.id === selectedId))
  const selected = matches[index]
  const optionId = selected ? `${listId}-${selected.id}` : undefined

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [optionId])

  function run(command) {
    if (!command) return
    onClose()
    requestAnimationFrame(() => onAction(command.id))
  }

  function handleKey(event) {
    if (isComposingKey(event.nativeEvent) || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'Enter') {
      event.preventDefault()
      run(selected)
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
      event.preventDefault()
      const offset = event.key === 'ArrowDown' ? 1 : -1
      const next = (index + offset + matches.length) % matches.length
      setSelectedId(matches[next].id)
    }
  }

  return <Modal title="命令面板" className="command-palette" onClose={onClose} initialFocusRef={input}>
    <div className="search-input">
      <Search size={18} aria-hidden="true"/>
      <input ref={input} type="text" role="combobox" aria-label="搜索命令" aria-autocomplete="list" aria-expanded={Boolean(matches.length)}
        aria-controls={listId} aria-activedescendant={optionId}
        placeholder="搜索命令，例如「审阅」或「导出」" value={query}
        onChange={event => { setQuery(event.target.value); setSelectedId(null) }}
        onKeyDown={handleKey}/>
    </div>
    <ul className="command-results" ref={list} id={listId} role="listbox" aria-label="匹配的命令" hidden={!matches.length}>
      {matches.map(command => {
        const shortcut = displayShortcut(effectiveShortcut(command, settings.hotkeys, platform), platform)
        return <li key={command.id} role="option" id={`${listId}-${command.id}`} aria-selected={selected?.id === command.id}
          onMouseDown={event => event.preventDefault()} onPointerMove={() => setSelectedId(command.id)} onClick={() => run(command)}>
          <span>{command.label}<small>{commandGroup(command)}</small></span>
          {shortcut && <kbd>{shortcut}</kbd>}
        </li>
      })}
    </ul>
    {!matches.length && <p className="sidebar-note" role="status">没有匹配的命令。</p>}
    <p className="command-instructions"><kbd>↑</kbd><kbd>↓</kbd> 选择 <kbd>Enter</kbd> 执行 <kbd>Esc</kbd> 关闭</p>
  </Modal>
}

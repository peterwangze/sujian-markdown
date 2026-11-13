import { useEffect, useLayoutEffect, useRef } from 'react'
import { isComposingKey } from '../workspace/commands.js'
import './document-context-menu.css'

export function documentContextEvents(item, open) {
  if (!open) return {}
  return {
    'aria-haspopup': 'menu',
    onContextMenu: event => open(event, item),
    onKeyDown: event => {
      if (isComposingKey(event.nativeEvent) || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event, item)
    },
  }
}

export function DocumentContextMenu({ context, groups, onAction, onDismiss }) {
  const ref = useRef(null)
  const { item } = context
  const editor = item.kind === 'editor'
  const selection = editor && item.detail.selection
  const heading = selection ? '选中文字' : editor && item.detail.canCopyImage ? '图片' : editor && item.detail.editable ? '当前位置' : item.name

  useLayoutEffect(() => {
    const menu = ref.current
    const gutter = 6
    menu.style.left = Math.max(gutter, Math.min(context.x, innerWidth - menu.offsetWidth - gutter)) + 'px'
    menu.style.top = Math.max(gutter, Math.min(context.y, innerHeight - menu.offsetHeight - gutter)) + 'px'
    menu.querySelector('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [context])

  useEffect(() => {
    const outside = event => {
      if (!ref.current?.contains(event.target)) onDismiss(false)
    }
    const resize = () => onDismiss(true)
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', resize)
    }
  }, [onDismiss])

  function keyDown(event) {
    if (isComposingKey(event.nativeEvent)) return
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault()
      event.stopPropagation()
      onDismiss(true, event.key === 'Escape')
      return
    }
    const items = [...ref.current.querySelectorAll('[role="menuitem"]')]
    const index = items.indexOf(document.activeElement)
    let next
    if (event.key === 'ArrowDown') next = (index + 1) % items.length
    if (event.key === 'ArrowUp') next = (index + items.length - 1) % items.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = items.length - 1
    if (next === undefined) return
    event.preventDefault()
    event.stopPropagation()
    items[next]?.focus()
  }

  return <div ref={ref} className="context-menu tool-menu-list document-context-menu" role="menu"
    aria-label={editor ? `${heading} · ${item.name}` : `操作 ${item.name}`} data-selection={selection || undefined} onKeyDown={keyDown}>
    <div className="document-context-name" aria-hidden="true" title={item.path || item.name}>{heading}</div>
    {groups.map((group, index) => <div key={group[0][0]} role="group">
      {index > 0 && <hr role="separator"/>}
      {group.map(([key, name]) => <button key={key} type="button" role="menuitem" tabIndex={-1}
        onClick={() => onAction(key)}>{name}</button>)}
    </div>)}
  </div>
}

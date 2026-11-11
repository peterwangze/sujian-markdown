import assert from 'node:assert/strict'
import test from 'node:test'
import { canRunCommand, commandsById, commandScore, displayShortcut, effectiveShortcut,
  findShortcut, nativeShortcutOverrides, normalizeShortcut, shortcutAssignmentError,
  shortcutConflict, shortcutFromEvent } from './commands.js'

function key(key, modifiers = {}) {
  return { key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers }
}

const windows = { platform: 'win32', native: true }
const mac = { platform: 'darwin', native: true }

test('uses Electron defaults and a single renderer path for explicit overrides', () => {
  const open = key('p', { ctrlKey: true })
  const palette = key('P', { ctrlKey: true, shiftKey: true })
  assert.equal(findShortcut(open, windows), null)
  assert.equal(findShortcut(open, { ...windows, native: false }), 'quick-open')
  assert.equal(findShortcut(palette, windows), 'command-palette')

  const hotkeys = { 'quick-open': ' Control + Shift + P ', 'command-palette': 'Ctrl+.', save: 'typo', 'new-window': 'Ctrl+2' }
  assert.deepEqual(nativeShortcutOverrides(hotkeys), { 'quick-open': 'Ctrl+Shift+P' })
  assert.equal(findShortcut(open, { ...windows, hotkeys, native: false }), null)
  assert.equal(findShortcut(palette, { ...windows, hotkeys }), 'quick-open')
  assert.equal(findShortcut(palette, { ...windows, hotkeys: { 'quick-open': 'Ctrl+Shift+P' } }), 'quick-open')
  assert.equal(findShortcut(key('.', { ctrlKey: true }), { ...windows, hotkeys }), 'command-palette')
  assert.equal(effectiveShortcut(commandsById.get('save'), hotkeys, 'win32'), 'Mod+S')
})

test('displays the real macOS native bindings and preserves Control-based tab switching', () => {
  const replace = effectiveShortcut(commandsById.get('replace'), {}, 'darwin')
  assert.equal(displayShortcut(replace, 'darwin'), '⌘⌥F')
  assert.equal(findShortcut(key('f', { metaKey: true, altKey: true }), { ...mac, native: false }), 'replace')
  assert.equal(findShortcut(key('Tab', { ctrlKey: true }), mac), 'next-tab')
  assert.equal(findShortcut(key('Tab', { ctrlKey: true, shiftKey: true }), mac), 'previous-tab')
  assert.equal(findShortcut(key('G', { metaKey: true }), mac), 'go-to-line')
  assert.equal(findShortcut(key('P', { metaKey: true, shiftKey: true }), mac), 'command-palette')
})

test('normalizes legacy aliases and shifted punctuation, and compares physical collisions', () => {
  assert.equal(normalizeShortcut(' option + Return + Control '), null)
  assert.equal(normalizeShortcut(' option + Control + Return '), 'Ctrl+Alt+Enter')
  assert.equal(normalizeShortcut('Ctrl++'), 'Ctrl+Plus')
  assert.equal(normalizeShortcut('Cmd+space'), 'Cmd+Space')
  assert.equal(normalizeShortcut('F8'), 'F8')
  assert.equal(shortcutFromEvent(key('?', { ctrlKey: true, shiftKey: true }), 'win32'), 'Mod+Shift+/')
  const hotkeys = { 'quick-open': 'Ctrl+Shift+?' }
  assert.equal(findShortcut(key('?', { ctrlKey: true, shiftKey: true }), { ...windows, hotkeys }), 'quick-open')
  assert.equal(shortcutConflict('save', 'Mod+Shift+/', hotkeys, 'win32'), '快速打开')
  assert.equal(shortcutConflict('save', 'Command+P', {}, 'darwin'), '快速打开')
  assert.equal(shortcutConflict('save', 'Control+P', {}, 'win32'), '快速打开')
})

test('guards IME, AltGraph, repeat, modal and previously handled key events', () => {
  const modifiers = { ctrlKey: true, shiftKey: true }
  assert.equal(findShortcut(key('P', { ...modifiers, isComposing: true }), windows), null)
  assert.equal(findShortcut(key('P', { ...modifiers, keyCode: 229 }), windows), null)
  assert.equal(findShortcut(key('Process', modifiers), windows), null)
  assert.equal(findShortcut(key('P', { ...modifiers, getModifierState: name => name === 'AltGraph' }), windows), null)
  assert.equal(findShortcut(key('P', { ...modifiers, repeat: true }), windows), null)
  assert.equal(findShortcut(key('P', { ...modifiers, defaultPrevented: true }), windows), null)
  assert.equal(findShortcut(key('P', modifiers), { ...windows, modalOpen: true }), null)
})

test('protects existing text entry, native editing and search keys when assigning a shortcut', () => {
  for (const binding of ['Ctrl+V', 'Mod+Enter', 'Shift+Tab', 'Shift+Space', 'Shift+A', 'F3', 'Shift+F3']) {
    assert.ok(shortcutAssignmentError('quick-open', binding, {}, 'win32'), binding)
  }
  assert.ok(shortcutAssignmentError('quick-open', 'Cmd+H', {}, 'darwin'))
  assert.equal(shortcutAssignmentError('quick-open', 'Mod+P', {}, 'win32'), '')
  assert.equal(shortcutAssignmentError('quick-open', 'Ctrl+Alt+K', {}, 'win32'), '')
})

test('ranks bilingual commands and excludes operations unavailable in the current workspace', () => {
  const find = commandsById.get('find')
  const replace = commandsById.get('replace')
  const navigate = commandsById.get('go-to-line')
  assert.ok(commandScore(navigate, 'go to line') > commandScore(navigate, 'gtl'))
  assert.ok(commandScore(navigate, '跳行') >= 0)
  assert.ok(commandScore(find, '搜索文字') >= 0)
  assert.equal(commandScore(find, 'zzz'), -1)
  assert.equal(canRunCommand(find, { active: null }), false)
  assert.equal(canRunCommand(find, { active: {}, mode: 'read' }), true)
  assert.equal(canRunCommand(replace, { active: {}, mode: 'read' }), false)
  assert.equal(canRunCommand(commandsById.get('search-folder'), { settings: { workspace: 'local' } }), true)
  assert.equal(canRunCommand(commandsById.get('next-tab'), { tabCount: 1 }), false)
})

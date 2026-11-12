import assert from 'node:assert/strict'
import test from 'node:test'
import { canRunCommand, commandsById, commandScore, displayShortcut, effectiveShortcut,
  findShortcut, isReassignedEditorShortcut, nativeShortcutOverrides, normalizeShortcut, shortcutAssignmentError,
  shortcutConflict, shortcutDefaultOverride, shortcutFromEvent } from './commands.js'

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

  const hotkeys = { 'quick-open': ' Control + Shift + P ', 'command-palette': 'Ctrl+.', save: 'typo', 'new-window': 'Ctrl+Alt+N' }
  assert.deepEqual(nativeShortcutOverrides(hotkeys), { 'quick-open': 'Ctrl+Shift+P', 'new-window': 'Ctrl+Alt+N' })
  assert.equal(findShortcut(open, { ...windows, hotkeys, native: false }), null)
  assert.equal(findShortcut(palette, { ...windows, hotkeys }), 'quick-open')
  assert.equal(findShortcut(palette, { ...windows, hotkeys: { 'quick-open': 'Ctrl+Shift+P' } }), 'quick-open')
  assert.equal(findShortcut(key('.', { ctrlKey: true }), { ...windows, hotkeys }), 'command-palette')
  assert.equal(findShortcut(key('N', { ctrlKey: true, shiftKey: true }), { ...windows, hotkeys }), null)
  assert.equal(findShortcut(key('n', { ctrlKey: true, altKey: true }), { ...windows, hotkeys }), 'new-window')
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

test('uses Ctrl or Command with 1 through 6 for heading levels', () => {
  for (const [platform, modifier] of [['win32', 'ctrlKey'], ['linux', 'ctrlKey'], ['darwin', 'metaKey']]) {
    const options = { platform, native: true }
    for (let level = 1; level <= 6; level++) {
      const id = `heading-${level}`
      const command = commandsById.get(id)
      assert.equal(findShortcut(key(String(level), { [modifier]: true }), options), id)
      assert.equal(command.editorPayload, level)
      assert.equal(canRunCommand(command, { active: {}, mode: 'live' }), true)
      assert.equal(canRunCommand(command, { active: {}, mode: 'read' }), false)
    }
    assert.equal(findShortcut(key('0', { [modifier]: true }), options), 'paragraph')
    assert.equal(findShortcut(key(')', { [modifier]: true, shiftKey: true }), options), 'reset-zoom')
    assert.equal(findShortcut(key('Tab', { ctrlKey: true }), options), 'next-tab')
  }
})

test('normalizes Typora-style formatting shortcuts on Windows and macOS', () => {
  const ctrl = { ctrlKey: true }, meta = { metaKey: true }
  const cases = [
    ['bold', key('b', ctrl), key('b', meta)],
    ['italic', key('i', ctrl), key('i', meta)],
    ['underline', key('u', ctrl), key('u', meta)],
    ['strike', key('%', { altKey: true, shiftKey: true }), key('~', { ctrlKey: true, shiftKey: true })],
    ['inline-code', key('~', { ...ctrl, shiftKey: true }), key('~', { ...meta, shiftKey: true })],
    ['link', key('k', ctrl), key('k', meta)],
    ['table', key('t', ctrl), key('†', { ...meta, altKey: true, code: 'KeyT' })],
    ['code', key('K', { ...ctrl, shiftKey: true }), key('ç', { ...meta, altKey: true, code: 'KeyC' })],
    ['math', key('M', { ...ctrl, shiftKey: true }), key('∫', { ...meta, altKey: true, code: 'KeyB' })],
    ['quote', key('Q', { ...ctrl, shiftKey: true }), key('œ', { ...meta, altKey: true, code: 'KeyQ' })],
    ['ordered-list', key('{', { ...ctrl, shiftKey: true }), key('ø', { ...meta, altKey: true, code: 'KeyO' })],
    ['list', key('}', { ...ctrl, shiftKey: true }), key('Dead', { ...meta, altKey: true, code: 'KeyU' })],
    ['indent', key('[', ctrl), key('[', meta)],
    ['outdent', key(']', ctrl), key(']', meta)],
    ['image', key('I', { ...ctrl, shiftKey: true }), key('i', { ...meta, ctrlKey: true })],
    ['copy-markdown', key('C', { ...ctrl, shiftKey: true }), key('C', { ...meta, shiftKey: true })],
  ]
  for (const [id, windowsEvent, macEvent] of cases) {
    assert.equal(findShortcut(windowsEvent, windows), id)
    assert.equal(findShortcut(macEvent, mac), id)
  }
})

test('recognizes rebound editor defaults and preserves a legacy zoom chord override', () => {
  const defaultBold = key('b', { ctrlKey: true })
  const zoom = key(')', { ctrlKey: true, shiftKey: true })
  const hotkeys = { bold: 'Ctrl+Shift+B', 'quick-open': 'Ctrl+Shift+0' }
  assert.equal(findShortcut(defaultBold, { ...windows, hotkeys }), null)
  assert.equal(isReassignedEditorShortcut(defaultBold, { ...windows, hotkeys }), true)
  assert.equal(isReassignedEditorShortcut(defaultBold, windows), false)
  assert.equal(findShortcut(key('B', { ctrlKey: true, shiftKey: true }), { ...windows, hotkeys }), 'bold')
  assert.equal(findShortcut(zoom, { ...windows, hotkeys }), 'quick-open')
})

test('preserves saved shortcuts when adding heading defaults and allows remapping headings', () => {
  const hotkeys = { 'quick-open': 'Ctrl+1', 'heading-2': 'Ctrl+Alt+K' }
  const heading = commandsById.get('heading-1')
  assert.equal(findShortcut(key('1', { ctrlKey: true }), { ...windows, hotkeys }), 'quick-open')
  assert.equal(shortcutDefaultOverride(heading, hotkeys, 'win32').id, 'quick-open')
  assert.equal(effectiveShortcut(heading, hotkeys, 'win32'), '')
  assert.equal(effectiveShortcut(heading, {}, 'win32'), 'Mod+1')
  assert.equal(findShortcut(key('2', { ctrlKey: true }), { ...windows, hotkeys }), null)
  assert.equal(findShortcut(key('k', { ctrlKey: true, altKey: true }), { ...windows, hotkeys }), 'heading-2')
  assert.equal(effectiveShortcut(commandsById.get('heading-2'), hotkeys, 'win32'), 'Ctrl+Alt+K')
  assert.equal(shortcutConflict('quick-open', 'Ctrl+3', hotkeys, 'win32'), '3 级标题')
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
  for (const binding of ['Ctrl+V', 'Mod+Enter', 'Mod+Plus', 'Mod+Shift+=', 'Shift+Tab', 'Shift+Space', 'Shift+A', 'F3', 'Shift+F3', 'Shift+F10']) {
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

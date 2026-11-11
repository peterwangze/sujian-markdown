const groups = {
  files: '文件',
  navigate: '导航',
  writing: '编辑',
  view: '视图',
  review: '审阅与交付',
  settings: '设置',
}

export const commands = [
  { id: 'command-palette', label: '命令面板', group: 'navigate', keys: 'Mod+Shift+P', keywords: 'palette commands mingling' },
  { id: 'quick-open', label: '快速打开', group: 'navigate', keys: 'Mod+P', nativeKey: true, keywords: '文件 go to file quick open kuaisudakai' },
  { id: 'new-file', label: '新建文档', group: 'files', keys: 'Mod+N', nativeKey: true, keywords: 'new 新文件' },
  { id: 'open-files', label: '打开文档', group: 'files', keys: 'Mod+O', nativeKey: true, keywords: 'open file 打开文件' },
  { id: 'open-folder', label: '打开文件夹', group: 'files', keys: 'Mod+Shift+O', nativeKey: true, requires: ['native'], keywords: 'workspace folder 工作区' },
  { id: 'new-window', label: '新建窗口', group: 'files', keys: 'Mod+Shift+N', nativeKey: true, fixed: true, requires: ['native'], keywords: 'new window' },
  { id: 'save', label: '保存', group: 'files', keys: 'Mod+S', nativeKey: true, requires: ['document'], keywords: 'save baocun' },
  { id: 'save-as', label: '另存为', group: 'files', keys: 'Mod+Shift+S', nativeKey: true, requires: ['document'], keywords: 'save as' },
  { id: 'close-tab', label: '关闭标签', group: 'files', keys: 'Mod+W', nativeKey: true, requires: ['document'], keywords: 'close tab' },
  { id: 'reopen-tab', label: '重新打开标签', group: 'files', keys: 'Mod+Shift+T', nativeKey: true, keywords: 'reopen tab 恢复关闭' },
  { id: 'next-tab', label: '切换到下一个标签', group: 'navigate', keys: 'Ctrl+Tab', requires: ['tabs'], keywords: 'next tab 下一个文件' },
  { id: 'previous-tab', label: '切换到上一个标签', group: 'navigate', keys: 'Ctrl+Shift+Tab', requires: ['tabs'], keywords: 'previous tab 上一个文件' },
  { id: 'go-to-line', label: '跳转到行', group: 'navigate', keys: 'Mod+G', requires: ['document'], keywords: 'go to line goto 定位 行号' },
  { id: 'find', label: '查找', group: 'writing', keys: 'Mod+F', nativeKey: true, requires: ['document'], keywords: 'find search 搜索文字' },
  { id: 'replace', label: '替换', group: 'writing', keys: 'Mod+H', macKeys: 'Cmd+Alt+F', nativeKey: true, requires: ['writing'], keywords: 'replace 替代' },
  { id: 'search-folder', label: '搜索工作区', group: 'navigate', keys: 'Mod+Shift+F', nativeKey: true, requires: ['workspace'], keywords: 'find in files 文件夹 全局搜索' },
  { id: 'view-live', label: '即时编辑', group: 'view', requires: ['document'], keywords: 'live preview 所见即所得 WYSIWYG' },
  { id: 'view-source', label: '切换源码', group: 'view', keys: 'Mod+/', nativeKey: true, requires: ['document'], keywords: 'source markdown 原文 yuanma' },
  { id: 'view-split', label: '分栏预览', group: 'view', requires: ['document'], keywords: 'split preview 双栏' },
  { id: 'view-read', label: '阅读模式', group: 'view', requires: ['document'], keywords: 'read preview' },
  { id: 'toggle-sidebar', label: '切换侧栏', group: 'view', keys: 'Mod+Shift+L', nativeKey: true, keywords: 'sidebar 侧边栏' },
  { id: 'toggle-focus', label: '专注模式', group: 'view', keys: 'F8', nativeKey: true, requires: ['document'], keywords: 'focus mode' },
  { id: 'toggle-typewriter', label: '打字机模式', group: 'view', keys: 'F9', nativeKey: true, requires: ['document'], keywords: 'typewriter mode' },
  { id: 'fullscreen', label: '全屏', group: 'view', keywords: 'fullscreen' },
  { id: 'toggle-dark', label: '切换深色模式', group: 'view', keywords: 'dark light 黑暗 theme 主题' },
  { id: 'pin-folder', label: '固定当前文件夹', group: 'files', requires: ['workspace'], keywords: 'pin folder 收藏' },
  { id: 'review', label: '审阅修订稿', group: 'review', requires: ['document'], keywords: 'review AI 修订 候选稿 diff shenyue' },
  { id: 'undo-review', label: '撤销本次审阅', group: 'review', requires: ['undoReview'], keywords: 'undo review 撤回' },
  { id: 'workflow-templates', label: '从模板创建文档', group: 'review', keywords: 'template 规格 会议 纪要' },
  { id: 'spec-check', label: '检查规格与验收', group: 'review', requires: ['document'], keywords: 'spec check 需求 验收 证据' },
  { id: 'source-link', label: '插入来源链接', group: 'review', requires: ['path', 'writing'], keywords: 'source link 引用 参考' },
  { id: 'import', label: '导入文档', group: 'files', requires: ['native'], keywords: 'import pandoc' },
  { id: 'export', label: '导出文档', group: 'review', keys: 'Mod+Shift+E', nativeKey: true, requires: ['document'], keywords: 'export PDF HTML Word 打包' },
  { id: 'print', label: '打印', group: 'review', requires: ['document', 'native'], keywords: 'print PDF' },
  { id: 'copy-markdown', label: '复制 Markdown', group: 'writing', requires: ['document'], keywords: 'copy source 复制源码' },
  { id: 'copy-rich', label: '复制富文本', group: 'writing', requires: ['document'], keywords: 'copy rich text' },
  { id: 'copy-html', label: '复制 HTML 源码', group: 'writing', requires: ['document'], keywords: 'copy HTML' },
  { id: 'copy-plain', label: '复制纯文本', group: 'writing', requires: ['document'], keywords: 'copy plain text' },
  { id: 'image', label: '插入本地图片', group: 'writing', requires: ['writing'], keywords: 'image 图像' },
  { id: 'upload-images', label: '上传本地图片', group: 'writing', requires: ['writing', 'native'], keywords: 'upload images' },
  { id: 'settings', label: '设置', group: 'settings', keys: 'Mod+,', nativeKey: true, keywords: 'preferences settings 字体 主题 外观 shezhi' },
  { id: 'shortcuts', label: '设置快捷键', group: 'settings', keywords: 'hotkey shortcut keyboard 按键 快捷操作' },
]

export const commandsById = new Map(commands.map(command => [command.id, command]))
export const configurableCommands = commands.filter(command => !command.fixed)

export function canRunCommand(command, { active, mode, settings, native, canUndoReview, tabCount = 0 }) {
  const enabled = {
    document: Boolean(active),
    writing: Boolean(active) && mode !== 'read',
    path: Boolean(active?.path),
    native,
    workspace: Boolean(settings?.workspace),
    undoReview: canUndoReview,
    tabs: tabCount > 1,
  }
  return (command.requires ?? []).every(requirement => enabled[requirement])
}

const modifierNames = new Map([
  ['ctrl', 'Ctrl'], ['control', 'Ctrl'], ['alt', 'Alt'], ['option', 'Alt'],
  ['shift', 'Shift'], ['cmd', 'Cmd'], ['command', 'Cmd'], ['meta', 'Cmd'], ['mod', 'Mod'],
])
const modifierOrder = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Cmd']
const namedKeys = new Map(Object.entries({
  enter: 'Enter', return: 'Enter', escape: 'Escape', esc: 'Escape',
  tab: 'Tab', backspace: 'Backspace', delete: 'Delete', del: 'Delete', insert: 'Insert',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
  arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  space: 'Space', plus: 'Plus',
}))
const shiftedKeys = new Map(Object.entries({
  '?': '/', ':': ';', '"': "'", '<': ',', '>': '.', '{': '[', '}': ']', '|': '\\', '~': '`',
  '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=',
}))

function normalizeKey(raw) {
  const value = raw.toLowerCase()
  if (raw === ' ') return 'Space'
  if (raw === '+') return 'Plus'
  if (namedKeys.has(value)) return namedKeys.get(value)
  if (/^f(?:[1-9]|1\d|2[0-4])$/.test(value)) return value.toUpperCase()
  const upper = raw.toUpperCase()
  return [...upper].length === 1 && !/[\s\p{C}]/u.test(raw) ? upper : null
}

export function normalizeShortcut(value) {
  if (typeof value !== 'string' || value.length > 90) return null
  const trimmed = value.trim()
  const parts = (trimmed.endsWith('++') ? trimmed.slice(0, -1) + 'Plus' : trimmed).split('+').map(part => part.trim())
  const key = normalizeKey(parts.pop() ?? '')
  if (!key) return null
  const modifiers = new Set()
  for (const part of parts) {
    const modifier = modifierNames.get(part.toLowerCase())
    if (!modifier || modifiers.has(modifier)) return null
    modifiers.add(modifier)
  }
  if (!modifiers.size && !/^F\d+$/.test(key)) return null
  return [...modifierOrder.filter(modifier => modifiers.has(modifier)), key].join('+')
}

export function defaultShortcut(command, platform) {
  return platform === 'darwin' && command.macKeys ? command.macKeys : command.keys ?? ''
}

export function effectiveShortcut(command, hotkeys, platform) {
  return (!command.fixed && normalizeShortcut(hotkeys?.[command.id])) || defaultShortcut(command, platform)
}

function physicalShortcut(value, platform) {
  const normalized = normalizeShortcut(value)
  if (!normalized) return ''
  const keys = normalized.split('+')
  const rawKey = keys.pop()
  const modifiers = new Set(keys.map(key => key === 'Mod' ? (platform === 'darwin' ? 'Cmd' : 'Ctrl') : key))
  const displayedKey = rawKey === 'Plus' ? '+' : rawKey
  const key = modifiers.has('Shift') ? (shiftedKeys.get(displayedKey) ?? displayedKey) : displayedKey
  return [...modifierOrder.filter(modifier => modifiers.has(modifier)), key].join('+')
}

export function displayShortcut(value, platform) {
  if (!value) return ''
  return value.split('+').map(key => {
    if (key === 'Mod') return platform === 'darwin' ? '⌘' : 'Ctrl'
    if (key === 'Plus') return '+'
    if (platform !== 'darwin') return key
    return { Cmd: '⌘', Alt: '⌥', Shift: '⇧', Ctrl: '⌃' }[key] ?? key
  }).join(platform === 'darwin' ? '' : '+')
}

export function isComposingKey(event) {
  return event.isComposing || event.keyCode === 229 || event.key === 'Process'
}

export function shortcutFromEvent(event, platform) {
  if (isComposingKey(event) || event.getModifierState?.('AltGraph')) return null
  const raw = event.shiftKey ? (shiftedKeys.get(event.key) ?? event.key) : event.key
  const key = normalizeKey(raw ?? '')
  if (!key) return null
  const modifiers = []
  if (event.ctrlKey) modifiers.push(platform === 'darwin' ? 'Ctrl' : 'Mod')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push(platform === 'darwin' ? 'Mod' : 'Cmd')
  return normalizeShortcut([...modifiers, key].join('+'))
}

export function findShortcut(event, { hotkeys, platform, native, modalOpen }) {
  if (event.defaultPrevented || event.repeat || modalOpen) return null
  const pressed = physicalShortcut(shortcutFromEvent(event, platform), platform)
  if (!pressed) return null
  const custom = configurableCommands.find(command => physicalShortcut(hotkeys?.[command.id], platform) === pressed)
  if (custom) return custom.id
  const fallback = commands.find(command => !(native && command.nativeKey) &&
    (command.fixed || !normalizeShortcut(hotkeys?.[command.id])) &&
    physicalShortcut(defaultShortcut(command, platform), platform) === pressed)
  return fallback?.id ?? null
}

const reserved = {
  common: ['Mod+A', 'Mod+C', 'Mod+V', 'Mod+X', 'Mod+Z', 'Mod+Shift+Z', 'Mod+Shift+V', 'Mod+Q', 'Mod+0', 'Mod+-', 'Mod+='],
  darwin: ['Cmd+H', 'Cmd+Alt+H', 'Cmd+M', 'Cmd+Alt+M', 'Cmd+Ctrl+F'],
  other: ['Ctrl+Y', 'F11'],
}

export function shortcutConflict(id, value, hotkeys, platform) {
  const shortcut = physicalShortcut(value, platform)
  if (!shortcut) return null
  if (shortcut === 'F3' || shortcut === 'Shift+F3') return '查找匹配项'
  if (shortcut === physicalShortcut('Mod+Enter', platform)) return '在表格中添加行'
  if ([...reserved.common, ...(platform === 'darwin' ? reserved.darwin : reserved.other)]
    .some(item => physicalShortcut(item, platform) === shortcut)) return '系统或文本编辑快捷键'
  const matched = commands.find(command => command.id !== id &&
    physicalShortcut(effectiveShortcut(command, hotkeys, platform), platform) === shortcut)
  return matched?.label ?? null
}

export function shortcutAssignmentError(id, value, hotkeys, platform) {
  const normalized = normalizeShortcut(value)
  if (!normalized) return '请按下或输入一个组合键。'
  if (normalized.startsWith('Shift+') && !/^Shift\+F\d+$/.test(normalized)) {
    return '请添加 Ctrl、Command 或 Alt，保留正常的文本输入和选择。'
  }
  const conflict = shortcutConflict(id, normalized, hotkeys, platform)
  return conflict ? `与「${conflict}」冲突，请换一个组合键。` : ''
}

export function nativeShortcutOverrides(hotkeys) {
  return Object.fromEntries(commands.filter(command => command.nativeKey && !command.fixed && normalizeShortcut(hotkeys?.[command.id]))
    .map(command => [command.id, normalizeShortcut(hotkeys[command.id])]))
}

function compact(value) {
  return value.toLowerCase().replace(/\s+/g, '')
}

export function commandScore(command, query) {
  const needle = compact(query)
  if (!needle) return 0
  const title = compact(command.label)
  const id = compact(command.id.replaceAll('-', ' '))
  if (needle === title || needle === id) return 1000
  if (title.startsWith(needle)) return 900
  if (title.includes(needle)) return 800
  const keywords = compact(command.keywords ?? '')
  if (id.includes(needle) || keywords.includes(needle) || compact(groups[command.group]).includes(needle)) return 700
  for (const text of [title, id]) {
    let index = 0
    for (const character of needle) {
      index = text.indexOf(character, index) + 1
      if (!index) break
    }
    if (index) return 300 - index
  }
  return -1
}

export function commandGroup(command) {
  return groups[command.group]
}

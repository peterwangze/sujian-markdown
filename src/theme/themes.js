const paper = {
  canvas: '#faf8f4', chrome: '#f5f2ed', sidebar: '#f1eee8', surface: '#fffdf9',
  ink: '#24211e', muted: '#6d645c', border: '#dad3ca', 'faint-border': '#e7e0d6',
  hover: '#ebe5dd', selected: '#f1dfd5', accent: '#a63826', 'accent-ink': '#8d2d1e',
  quote: '#f7eae1', 'table-head': '#eee8df', shadow: '0 10px 28px #3025181f, 0 2px 4px #30251813',
  selection: '#f4e2d9', 'syntax-code': '#674078', 'syntax-link': '#255c83', 'syntax-quote': '#526244',
}

const dark = {
  canvas: '#232120', chrome: '#272423', sidebar: '#2b2826', surface: '#322e2b',
  ink: '#ebe3d9', muted: '#b9aea2', border: '#4e4540', 'faint-border': '#413a36',
  hover: '#39332f', selected: '#4d342d', accent: '#ed9a82', 'accent-ink': '#ffb59f',
  quote: '#382c27', 'table-head': '#342e29', shadow: '0 10px 28px #0006, 0 2px 4px #0004',
  selection: '#533c32', 'syntax-code': '#dcc1f2', 'syntax-link': '#9ecff4', 'syntax-quote': '#bfd4aa',
}

function theme(id, name, description, scheme, colors, highContrast = false) {
  return Object.freeze({ id, name, description, scheme, colors: Object.freeze(colors), highContrast })
}

export const BUILT_IN_THEMES = Object.freeze([
  theme('paper', '暖白', '柔和纸色，适合日常写作', 'light', paper),
  theme('light', '亮白', '清透白底，适合明亮环境', 'light', {
    ...paper, canvas: '#ffffff', chrome: '#f9f9f8', sidebar: '#f5f5f4', surface: '#ffffff',
    border: '#dedddb', 'faint-border': '#eae9e6', hover: '#efeeec', 'table-head': '#f1f0ee',
  }),
  theme('sepia', '羊皮纸', '暖褐纸色，适合长文阅读', 'light', {
    ...paper, canvas: '#f5ecd9', chrome: '#efe3cc', sidebar: '#ebdec4', surface: '#fbf5e8',
    ink: '#382c20', muted: '#63513c', border: '#c6b28e', 'faint-border': '#dfd0b2',
    hover: '#ebddbf', selected: '#ebd6ae', accent: '#8a4e22', 'accent-ink': '#773b17',
    quote: '#f0e1c2', 'table-head': '#eaddbf', selection: '#efd4ab',
    'syntax-code': '#684374', 'syntax-link': '#305c68', 'syntax-quote': '#5f603c',
  }),
  theme('mist', '雾蓝', '低饱和蓝灰，适合技术文档', 'light', {
    ...paper, canvas: '#eff4f7', chrome: '#e7edf2', sidebar: '#e0e8ef', surface: '#f9fcfe',
    ink: '#202e39', muted: '#465b6c', border: '#aabcc9', 'faint-border': '#c7d5df',
    hover: '#dfe9f1', selected: '#d2e3f1', accent: '#286185', 'accent-ink': '#235676',
    quote: '#e2edf4', 'table-head': '#dce8ef', selection: '#c7dced',
    'syntax-code': '#5d4278', 'syntax-link': '#235676', 'syntax-quote': '#43644d',
  }),
  theme('dark', '深墨', '暖调深灰，适合低光环境', 'dark', dark),
  theme('forest', '松影', '低饱和松绿，适合低光阅读', 'dark', {
    ...dark, canvas: '#202b28', chrome: '#26332e', sidebar: '#2a3931', surface: '#2e3e36',
    ink: '#e5eae4', muted: '#adc2b3', border: '#5b7566', 'faint-border': '#445b50',
    hover: '#354940', selected: '#3c584b', accent: '#a3d3b2', 'accent-ink': '#bde6c8',
    quote: '#2b4035', 'table-head': '#31473b', selection: '#354e43',
    'syntax-code': '#ebcbae', 'syntax-link': '#a9d4fb', 'syntax-quote': '#c0dba9',
  }),
  theme('contrast', '高对比', '黑底白字、明确边界和焦点', 'dark', {
    ...dark, canvas: '#000000', chrome: '#080808', sidebar: '#101010', surface: '#000000',
    ink: '#ffffff', muted: '#e3e3e3', border: '#adadad', 'faint-border': '#787878',
    hover: '#232323', selected: '#302e0c', accent: '#ffdc5d', 'accent-ink': '#ffe373',
    quote: '#181500', 'table-head': '#1a1a1a', selection: '#4c4200', shadow: '0 6px 20px #000',
    'syntax-code': '#ffcfb2', 'syntax-link': '#a8d8ff', 'syntax-quote': '#ccefb3',
  }, true),
])

const byId = new Map(BUILT_IN_THEMES.map(item => [item.id, item]))

export const THEME_OPTIONS = Object.freeze([
  ...BUILT_IN_THEMES,
  theme('system', '跟随系统', '按系统外观切换暖白或深墨', 'system', paper),
])

export function resolveTheme(id, systemDark = false) {
  const key = id === 'system' ? (systemDark ? 'dark' : 'paper') : id
  return byId.get(key) ?? byId.get('paper')
}

export function themeDeclarations(item) {
  const palette = Object.entries(item.colors).map(([name, value]) => `--${name}:${value};`).join('')
  return `color-scheme:${item.scheme};${palette}`
}

export function applyTheme(root, item) {
  root.dataset.theme = item.id
  root.dataset.colorScheme = item.scheme
  root.dataset.contrast = item.highContrast ? 'high' : 'normal'
  const doc = root.ownerDocument
  let palette = doc.getElementById('sujian-theme-palette')
  if (!palette) {
    palette = doc.createElement('style')
    palette.id = 'sujian-theme-palette'
    doc.head.append(palette)
  }
  // A stylesheet lets the user's custom CSS still override the built-in defaults.
  palette.textContent = `:root{${themeDeclarations(item)}}`
}

const data = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}

function chooseFiles(accept) {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = accept
    input.onchange = () => resolve([...input.files])
    input.oncancel = () => resolve([])
    input.click()
  })
}

function download(name, contents, type) {
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(new Blob([contents], { type }))
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000)
}

const noop = () => {}
const browser = {
  platform: 'browser',
  async openFiles() {
    const files = await chooseFiles('.md,.markdown,.txt,.mdx,.mdown,.mkd')
    return Promise.all(files.map(async file => ({ name: file.name, text: await file.text(), hash: String(file.lastModified) })))
  },
  async saveFile({ text, defaultName }) {
    download(defaultName, text, 'text/markdown;charset=utf-8')
    return { status: 'ok', document: { name: defaultName, text } }
  },
  async loadDrafts() { return Object.values(data('sujian-drafts', {})) },
  async saveDraft(draft) {
    localStorage.setItem('sujian-drafts', JSON.stringify({ ...data('sujian-drafts', {}), [draft.id]: draft }))
  },
  async deleteDraft(id) {
    const drafts = data('sujian-drafts', {})
    delete drafts[id]
    localStorage.setItem('sujian-drafts', JSON.stringify(drafts))
  },
  async loadPreferences() { return data('sujian-settings', {}) },
  async savePreferences(settings) { localStorage.setItem('sujian-settings', JSON.stringify(settings)) },
  async importImage({ bytes, filename }) {
    const file = bytes ? new File([bytes], filename) : (await chooseFiles('image/*'))[0]
    if (!file) return null
    const reader = new FileReader()
    const source = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    return { markdownPath: source }
  },
  async exportDocument({ format, html, text, defaultName }) {
    if (format !== 'html' && format !== 'html-plain' && format !== 'markdown') {
      throw new Error('此格式可在素笺桌面版中导出。')
    }
    const name = defaultName.replace(/\.[^.]*$/, '') + (format === 'markdown' ? '.md' : '.html')
    download(name, format === 'markdown' ? text : html, format === 'markdown' ? 'text/markdown' : 'text/html')
    return { path: name }
  },
  async openExternal(url) { window.open(url, '_blank', 'noopener,noreferrer') },
  async toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  },
  async writeClipboard({ text, html }) {
    if (html && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })])
    } else await navigator.clipboard.writeText(text)
  },
  setWatchedFiles: noop,
  setTitleBarTheme: noop,
}

export const desktop = window.sujian ?? browser
export const native = desktop.platform !== 'browser'

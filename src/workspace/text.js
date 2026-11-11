export const MAX_LIVE_LENGTH = 200_000

export function headings(markdown) {
  const result = []
  let fence
  let previous = ''
  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) fence = undefined
      previous = ''
      continue
    }
    if (fence) continue
    const atx = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    const setext = previous && line.match(/^ {0,3}(=+|-+)\s*$/)
    if (atx) result.push({ depth: atx[1].length, title: atx[2], line: index + 1 })
    else if (setext) result.push({ depth: setext[1][0] === '=' ? 1 : 2, title: previous.trim(), line: index })
    previous = atx || setext || /^\s*(?:[-+*>]|\d+[.)]\s)/.test(line) ? '' : line.trim()
  }
  return result
}

export function wordCount(text) {
  const eastAsian = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
  const words = text.replace(eastAsian, ' ').match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)
  return (text.match(eastAsian)?.length ?? 0) + (words?.length ?? 0)
}

export function fuzzy(text, query) {
  const haystack = text.toLowerCase()
  const needle = query.trim().toLowerCase()
  if (!needle) return 0
  const exact = haystack.indexOf(needle)
  if (exact >= 0) return 1000 - exact
  let index = 0
  for (const char of needle) {
    index = haystack.indexOf(char, index) + 1
    if (index === 0) return -1
  }
  return 100 - index
}

export function slug(text) {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, '-')
}

export const formats = [
  ['pdf','PDF 文档'], ['html','HTML（带样式）'], ['html-plain','HTML（仅内容）'],
  ['png','PNG 长图'], ['docx','Microsoft Word'], ['odt','OpenDocument'],
  ['rtf','富文本 RTF'], ['epub','EPUB 电子书'], ['latex','LaTeX'],
  ['rst','reStructuredText'], ['org','Emacs Org'], ['mediawiki','MediaWiki'],
  ['textile','Textile'], ['opml','OPML 大纲'], ['revealjs','Reveal.js 幻灯片'],
  ['gfm','GitHub Markdown'], ['commonmark','CommonMark'], ['markdown','Pandoc Markdown'], ['plain','纯文本'],
]

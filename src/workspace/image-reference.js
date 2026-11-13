import { markdownLanguage } from '@codemirror/lang-markdown'

const unescapeMarkdown = value => value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1')

function decodeEntities(value) {
  if (!value.includes('&') || typeof document === 'undefined') return value
  const text = document.createElement('textarea')
  text.innerHTML = value.replaceAll('<', '&lt;')
  return text.value
}

export function imageSourceKey(value) {
  if (/^(?:https?:\/\/|\/\/)/i.test(value)) {
    try { return new URL(value.startsWith('//') ? 'https:' + value : value).href } catch { return value }
  }
  try { return decodeURIComponent(value).replaceAll('\\', '/') } catch { return value }
}

export function displayedImageKey(source) {
  if (!source) return undefined
  if (/^https?:\/\//i.test(source)) return imageSourceKey(source)
  if (!source.startsWith('sujian-asset://local/')) return undefined
  try {
    const token = new URL(source).pathname.slice(1).replaceAll('-', '+').replaceAll('_', '/')
    const bytes = Uint8Array.from(atob(token), character => character.charCodeAt(0))
    const [, address] = JSON.parse(new TextDecoder().decode(bytes))
    return typeof address === 'string' ? imageSourceKey(address) : undefined
  } catch { return undefined }
}

function target(markdown, url) {
  const raw = markdown.slice(url.from, url.to)
  const angled = raw.startsWith('<')
  const address = angled ? raw.slice(1, -1) : raw
  return { from: url.from + Number(angled), to: url.to - Number(angled), address: decodeEntities(unescapeMarkdown(address)) }
}

function normalizeLabel(value) {
  return value.trim().replace(/\s+/g, ' ').toUpperCase().toLowerCase()
}

function collectHtmlImages(markdown, from, to, add) {
  const html = markdown.slice(from, to)
  // Scan full tags so an attribute containing "<img ...>" cannot look like another tag.
  const tags = /<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi
  const rawText = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'template'])
  let skip
  for (const match of html.matchAll(tags)) {
    const tag = match[1]?.toLowerCase()
    const closing = match[0].startsWith('</')
    if (skip) {
      if (tag === skip && closing) skip = null
      continue
    }
    if (!tag || closing) continue
    if (rawText.has(tag)) { skip = tag; continue }
    if (tag !== 'img') continue

    const attributes = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
    const attributeText = match[0].slice(4, -1)
    for (const attribute of attributeText.matchAll(attributes)) {
      if (attribute[1].toLowerCase() !== 'src') continue
      const address = attribute[2] ?? attribute[3] ?? attribute[4]
      if (!address) break
      const start = from + match.index + 4 + attribute.index + attribute[0].indexOf('=') + 1
      const leading = /^\s*["']?/.exec(markdown.slice(start))[0].length
      add({ from: start + leading, to: start + leading + address.length, address: decodeEntities(address) })
      break
    }
  }
}

export function findImageReference(markdown, key, ordinal, renderedCount) {
  const raw = markdown
  markdown = raw.replace(/\r\n?/g, '\n')
  const tree = markdownLanguage.parser.parse(markdown)
  const definitions = new Map()
  tree.iterate({ enter(node) {
    if (node.name !== 'LinkReference') return
    const label = node.node.getChild('LinkLabel')
    const url = node.node.getChild('URL')
    if (!label || !url) return
    const key = normalizeLabel(markdown.slice(label.from + 1, label.to - 1))
    if (definitions.has(key)) return
    const title = node.node.getChild('LinkTitle')
    definitions.set(key, { address: target(markdown, url).address, title: title ? markdown.slice(title.from, title.to) : '' })
  } })

  const matches = []
  const add = candidate => {
    if (imageSourceKey(candidate.address) === key) matches.push(candidate)
  }
  tree.iterate({ enter(node) {
    if (node.name === 'HTMLTag' || node.name === 'HTMLBlock') collectHtmlImages(markdown, node.from, node.to, add)
    if (node.name !== 'Image') return
    const url = node.node.getChild('URL')
    if (url) add(target(markdown, url))
    else {
      const altEnd = node.node.getChildren('LinkMark')[1]?.to
      if (altEnd === undefined) return false
      const label = node.node.getChild('LinkLabel')
      const alternate = markdown.slice(node.from + 2, altEnd - 1)
      const reference = definitions.get(normalizeLabel((label && markdown.slice(label.from + 1, label.to - 1)) || alternate))
      if (reference) add({ from: altEnd, to: node.to, address: reference.address, referenceTitle: reference.title })
    }
    return false
  } })
  const match = matches.length === renderedCount ? matches[ordinal] : undefined
  if (!match || raw.length === markdown.length) return match
  let from = match.from, to = match.to
  for (const newline of raw.matchAll(/\r\n/g)) {
    if (newline.index < from) from += 1
    if (newline.index < to) to += 1
  }
  return { ...match, from, to }
}

export function imageReferenceReplacement(reference, address) {
  if (reference.referenceTitle === undefined) return address
  const title = reference.referenceTitle ? ' ' + reference.referenceTitle : ''
  return '(' + address + title + ')'
}

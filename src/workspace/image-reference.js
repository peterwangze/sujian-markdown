import { markdownLanguage } from '@codemirror/lang-markdown'

const unescapeMarkdown = value => value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1')
const namedEntities = new Map(Object.entries({ amp: '&', apos: "'", gt: '>', lt: '<', nbsp: '\u00a0', quot: '"' }))
const inertTags = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'template'])

function decodeEntities(value) {
  if (!value.includes('&')) return value
  let template
  return value.replace(/&(?:#([xX][\da-fA-F]+|\d+)|([a-zA-Z][a-zA-Z\d]*));/g, (entity, number, name) => {
    if (name && namedEntities.has(name)) return namedEntities.get(name)
    if (typeof document !== 'undefined') {
      template ??= document.createElement('template')
      template.innerHTML = `<span data-entity="${entity}"></span>`
      return template.content.firstElementChild.getAttribute('data-entity')
    }
    if (name) return entity
    const code = number[0].toLowerCase() === 'x' ? Number.parseInt(number.slice(1), 16) : Number(number)
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : '\ufffd'
  })
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

function collectHtmlImages(markdown, from, to, add, state) {
  const html = markdown.slice(from, to)
  // Scan full tags so an attribute containing "<img ...>" cannot look like another tag.
  const tags = /<!--[\s\S]*?(?:-->|$)|<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi
  for (const match of html.matchAll(tags)) {
    const tag = match[1]?.toLowerCase()
    const closing = match[0].startsWith('</')
    const parent = state.inert.at(-1)
    if (parent === tag && closing) {
      state.inert.pop()
      continue
    }
    if (parent && parent !== 'template') continue
    if (!tag || closing) continue
    if (inertTags.has(tag)) { state.inert.push(tag); continue }
    if (parent || tag !== 'img') continue

    const attributes = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
    const attributeText = match[0].slice(4, -1)
    for (const attribute of attributeText.matchAll(attributes)) {
      if (attribute[1].toLowerCase() !== 'src') continue
      const address = attribute[2] ?? attribute[3] ?? attribute[4]
      if (!address?.trim()) {
        add({ from: from + match.index, to: from + match.index + match[0].length, address: match[0], unresolved: true })
        break
      }
      const start = from + match.index + 4 + attribute.index + attribute[0].indexOf('=') + 1
      const leading = /^\s*["']?/.exec(markdown.slice(start))[0].length
      add({ from: start + leading, to: start + leading + address.length, address: decodeEntities(address) })
      break
    }
  }
}

function frontMatterEnd(markdown) {
  const match = /^\uFEFF?---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(markdown)
  return match && /^[\w.-]+[ \t]*:/m.test(match[1]) ? match[0].length : 0
}

export function listImageReferences(raw) {
  const removedReturns = []
  const normalized = raw.replace(/\r\n?/g, (segment, index) => {
    if (segment.length === 2) removedReturns.push(index - removedReturns.length)
    return '\n'
  })
  const contentStart = frontMatterEnd(normalized)
  const markdown = normalized.slice(contentStart)
  // Convert parser positions back to raw indices, including each skipped CR in CRLF.
  const rawOffset = offset => {
    const index = offset + contentStart
    let low = 0, high = removedReturns.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (removedReturns[middle] < index) low = middle + 1
      else high = middle
    }
    return index + low
  }
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
    definitions.set(key, { address: target(markdown, url).address, title: title ? raw.slice(rawOffset(title.from), rawOffset(title.to)) : '' })
  } })

  const references = []
  const add = candidate => {
    references.push({ ...candidate, from: rawOffset(candidate.from), to: rawOffset(candidate.to) })
  }
  const unresolved = node => add({ from: node.from, to: node.to, address: raw.slice(rawOffset(node.from), rawOffset(node.to)), unresolved: true })
  const htmlState = { inert: [] }
  tree.iterate({ enter(node) {
    if (node.name === 'HTMLTag' || node.name === 'HTMLBlock') collectHtmlImages(markdown, node.from, node.to, add, htmlState)
    if (node.name !== 'Image') return
    if (htmlState.inert.length) return false
    const url = node.node.getChild('URL')
    if (url) {
      const image = target(markdown, url)
      if (image.address.trim()) add(image)
      else unresolved(node)
    } else {
      const [, end, destination] = node.node.getChildren('LinkMark')
      const altEnd = end?.to
      if (altEnd === undefined) return false
      if (destination) { unresolved(node); return false }
      const label = node.node.getChild('LinkLabel')
      const alternate = markdown.slice(node.from + 2, altEnd - 1)
      const reference = definitions.get(normalizeLabel((label && markdown.slice(label.from + 1, label.to - 1)) || alternate))
      if (reference?.address) add({ from: altEnd, to: node.to, address: reference.address, referenceTitle: reference.title })
      else unresolved(node)
    }
    return false
  } })
  return references
}

export function findImageReference(markdown, key, ordinal, renderedCount) {
  const matches = listImageReferences(markdown).filter(reference => !reference.unresolved && imageSourceKey(reference.address) === key)
  return matches.length === renderedCount ? matches[ordinal] : undefined
}

export function imageReferenceReplacement(reference, address) {
  if (reference.referenceTitle === undefined) return address
  const title = reference.referenceTitle ? ' ' + reference.referenceTitle : ''
  return '(' + address + title + ')'
}

export function replaceImageReferences(markdown, references, replacements) {
  const parts = []
  let end = 0
  for (const reference of references) {
    const address = !reference.unresolved && replacements.get(reference.address)
    if (!address || reference.from < end) continue
    const replacement = imageReferenceReplacement(reference, address)
    if (replacement === markdown.slice(reference.from, reference.to)) continue
    parts.push(markdown.slice(end, reference.from), replacement)
    end = reference.to
  }
  return parts.length ? parts.join('') + markdown.slice(end) : markdown
}

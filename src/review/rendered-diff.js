import { diffArrays } from 'diff'
import { buildInlineDiff } from './inline-diff.js'

const TEXT_BLOCK = 'h1, h2, h3, h4, h5, h6, p, li, pre, th, td, summary, dt, dd, blockquote, div, figcaption'
const SKIP_TEXT = '[hidden], [aria-hidden="true"], svg, math, .language-math, .katex, .markdown-diagram, .vditor-toc, .vditor-anchor, script, style, textarea, select, button'
const MAX_BLOCKS = 4_096
const MAX_NODES = 90_000
const MAX_TEXT_NODES = 40_000
const MAX_TEXT_LENGTH = 240_000
const MAX_BLOCK_EDITS = 96
const MAX_BLOCK_COMPARISONS = 64
const MAX_MARKERS = 1_200

function kindOf(element) {
  const tag = element.localName
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (tag === 'th' || tag === 'td') return 'cell'
  if (tag === 'p' && element.parentElement?.matches('li')) return 'li'
  return tag
}

function readBlocks(article) {
  const blocks = []
  const known = new Map()
  const rows = new Map()
  const walker = article.ownerDocument.createTreeWalker(article, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.nodeType === Node.ELEMENT_NODE && node.matches(SKIP_TEXT)
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })

  function readRow(element) {
    let row = rows.get(element)
    if (!row) {
      row = { kind: 'row', cells: [] }
      rows.set(element, row)
      blocks.push(row)
    }
    return row
  }

  function readBlock(element) {
    let block = known.get(element)
    if (!block) {
      block = { kind: kindOf(element), nodes: [], text: '' }
      known.set(element, block)
      const rowElement = block.kind === 'cell' && element.closest('tr')
      if (rowElement) readRow(rowElement).cells.push(block)
      else blocks.push(block)
    }
    return block
  }

  let nodeCount = 0
  let textNodeCount = 0
  let textLength = 0
  let node
  while ((node = walker.nextNode())) {
    if (++nodeCount > MAX_NODES) return null
    if (node.nodeType === Node.ELEMENT_NODE) {
      // Empty rows and cells still occupy structural positions in a table.
      if (node.matches('tr')) readRow(node)
      if (node.matches('th, td')) readBlock(node)
    } else {
      if (++textNodeCount > MAX_TEXT_NODES) return null
      const cell = node.parentElement.closest('th, td')
      const element = cell ?? node.parentElement.closest(TEXT_BLOCK) ?? article
      if (!node.length || element === article && !node.data.trim()) continue
      textLength += node.length
      if (textLength > MAX_TEXT_LENGTH) return null
      const block = readBlock(element)
      block.nodes.push(node)
      block.text += node.data
    }
    if (known.size + rows.size > MAX_BLOCKS) return null
  }

  for (const block of known.values()) block.key = block.text
  for (const row of rows.values()) {
    const cells = row.cells.map(cell => cell.text)
    row.text = cells.join(' ')
    row.key = JSON.stringify(cells)
  }
  return blocks
}

function alignedPairs(before, after, comparator) {
  const parts = diffArrays(before, after, { comparator, maxEditLength: MAX_BLOCK_EDITS })
  if (!parts) return null
  const pairs = []
  let oldIndex = 0
  let newIndex = 0
  for (const part of parts) {
    if (part.removed) oldIndex += part.count
    else if (part.added) newIndex += part.count
    else {
      for (let i = 0; i < part.count; i++) pairs.push([oldIndex++, newIndex++])
    }
  }
  return pairs
}

function sameBlock(before, after) {
  return before.kind === after.kind && before.key === after.key
}

function blockSimilarity(before, after) {
  if (before.kind !== after.kind) return 0
  const oldText = before.text.trim()
  const newText = after.text.trim()
  const length = Math.min(oldText.length, newText.length)
  // A substantial shared edge is an ordered anchor when a changed block also has new neighbors.
  const edgeLimit = Math.min(128, length)
  let start = 0
  let end = 0
  while (start < edgeLimit && oldText[start] === newText[start]) start++
  while (end < edgeLimit && start + end < length && oldText.at(-end - 1) === newText.at(-end - 1)) end++
  const shared = start + end
  const inspected = Math.min(length, edgeLimit * 2)
  return shared >= Math.max(2, Math.ceil(inspected / 2)) ? shared / inspected : 0
}

function similarPairs(before, after) {
  // An exact-diff gap contains at most MAX_BLOCK_EDITS unmatched blocks in total.
  const width = after.length + 1
  const scores = Array.from({ length: before.length + 1 }, () => new Float64Array(width))
  const choices = Array.from({ length: before.length }, () => new Uint8Array(after.length))
  for (let oldIndex = before.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = after.length - 1; newIndex >= 0; newIndex--) {
      const similarity = blockSimilarity(before[oldIndex], after[newIndex])
      const skipOld = scores[oldIndex + 1][newIndex]
      const skipNew = scores[oldIndex][newIndex + 1]
      const pair = similarity + scores[oldIndex + 1][newIndex + 1]
      if (similarity && pair >= Math.max(skipOld, skipNew)) {
        scores[oldIndex][newIndex] = pair
        choices[oldIndex][newIndex] = 2
      } else {
        scores[oldIndex][newIndex] = Math.max(skipOld, skipNew)
        choices[oldIndex][newIndex] = Number(skipNew > skipOld)
      }
    }
  }
  const pairs = []
  let oldIndex = 0
  let newIndex = 0
  while (oldIndex < before.length && newIndex < after.length) {
    const choice = choices[oldIndex][newIndex]
    if (choice === 2) pairs.push([oldIndex++, newIndex++])
    else if (choice === 1) newIndex++
    else oldIndex++
  }
  return pairs
}

function planTextMarkers(block, spans, markers) {
  let index = 0
  let offset = 0
  for (const span of spans) {
    let remaining = span.text.length
    while (remaining) {
      const node = block.nodes[index]
      const size = Math.min(remaining, node.length - offset)
      const end = offset + size
      if (span.changed) markers.push({ node, start: offset, end })
      remaining -= size
      offset = end
      if (offset === node.length) {
        index++
        offset = 0
      }
    }
  }
}

function planWholeBlocks(blocks, markers) {
  for (const block of blocks) {
    if (block.cells) planWholeBlocks(block.cells, markers)
    else planTextMarkers(block, [{ text: block.text, changed: true }], markers)
  }
}

function comparePair(before, after, plan) {
  if (sameBlock(before, after) || plan.remaining < 0) return
  if (--plan.remaining < 0) return
  if (before.cells && after.cells) {
    if (before.cells.length === after.cells.length) {
      before.cells.forEach((cell, index) => comparePair(cell, after.cells[index], plan))
    } else {
      compareBlocks(before.cells, after.cells, plan)
    }
    return
  }
  const spans = buildInlineDiff(before.text, after.text)
  planTextMarkers(before, spans.before, plan.before)
  planTextMarkers(after, spans.after, plan.after)
}

function compareRemaining(before, after, plan) {
  if (before.length === after.length && before.every((block, index) => block.kind === after[index].kind)) {
    before.forEach((block, index) => comparePair(block, after[index], plan))
  } else {
    planWholeBlocks(before, plan.before)
    planWholeBlocks(after, plan.after)
  }
}

function compareGap(before, after, plan) {
  const pairs = before.length && after.length ? similarPairs(before, after) : []
  let oldStart = 0
  let newStart = 0
  for (const [oldIndex, newIndex] of pairs) {
    compareRemaining(before.slice(oldStart, oldIndex), after.slice(newStart, newIndex), plan)
    comparePair(before[oldIndex], after[newIndex], plan)
    oldStart = oldIndex + 1
    newStart = newIndex + 1
  }
  compareRemaining(before.slice(oldStart), after.slice(newStart), plan)
}

function compareBlocks(before, after, plan) {
  const pairs = alignedPairs(before, after, sameBlock)
  if (!pairs) {
    plan.remaining = -1
    return
  }
  let oldStart = 0
  let newStart = 0
  for (const [oldIndex, newIndex] of pairs) {
    if (oldStart !== oldIndex || newStart !== newIndex) {
      compareGap(before.slice(oldStart, oldIndex), after.slice(newStart, newIndex), plan)
    }
    oldStart = oldIndex + 1
    newStart = newIndex + 1
  }
  compareGap(before.slice(oldStart), after.slice(newStart), plan)
}

function insertMarkers(markers, tag) {
  for (const { node, start, end } of markers.reverse()) {
    const document = node.ownerDocument
    const range = document.createRange()
    const marker = document.createElement(tag)
    marker.className = 'review-rendered-change'
    range.setStart(node, start)
    range.setEnd(node, end)
    range.surroundContents(marker)
  }
}

/** Mark changed visible text in detached previews; oversized comparisons stay plain. */
export function markRenderedDiff(beforeArticle, afterArticle) {
  const before = readBlocks(beforeArticle)
  const after = readBlocks(afterArticle)
  if (!before || !after) return false
  const plan = { before: [], after: [], remaining: MAX_BLOCK_COMPARISONS }
  compareBlocks(before, after, plan)
  if (plan.remaining < 0 || plan.before.length + plan.after.length > MAX_MARKERS) return false
  insertMarkers(plan.before, 'del')
  insertMarkers(plan.after, 'ins')
  return true
}

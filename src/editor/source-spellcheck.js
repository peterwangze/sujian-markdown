import { syntaxTree } from '@codemirror/language'
import { Decoration, ViewPlugin } from '@codemirror/view'
import { technicalSpellcheckRanges } from './technical-spellcheck.js'

const excludedNodes = new Set([
  'FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'HTMLTag', 'Comment',
  'CommentBlock', 'ProcessingInstruction', 'ProcessingInstructionBlock',
  'Autolink', 'URL', 'LinkLabel', 'LinkReference',
])
const inlineBlock = /^(?:Paragraph|ATXHeading[1-6]|SetextHeading[12]|TableCell)$/
const inlineCodeTag = /^<(\/?)(code|kbd|samp|tt|var)(?=[\s/>])/i
const inlineMath = /(?<![\\$])(?:\$\$((?:\\.|[^\\$\r\n])+?)\$\$(?!\$)|\$(?![$\d])((?:\\.|[^\\$\r\n])+?)\$(?![$\d]))/g
const blockMath = /^ {0,3}(?:>[ \t]{0,3})*\$\$[ \t]*\n[\s\S]*?^ {0,3}(?:>[ \t]{0,3})*\$\$[ \t]*$/gm
const frontMatterFence = /^---[ \t]*$/
const unchecked = Decoration.mark({ attributes: { spellcheck: 'false' } })

function yamlFrontMatterEnd(doc) {
  if (!frontMatterFence.test(doc.line(1).text)) return 0
  let hasField = false
  // Bound the scan for an unfinished header in a large document.
  for (let number = 2; number <= Math.min(doc.lines, 257); number += 1) {
    const line = doc.line(number)
    if (frontMatterFence.test(line.text)) return hasField ? line.to : 0
    if (/^[\w.-]+[ \t]*:/.test(line.text)) hasField = true
  }
  return 0
}

function codeAt(tree, position) {
  for (let node = tree.resolveInner(position, 1); node; node = node.parent) {
    if (excludedNodes.has(node.name)) return true
  }
  return false
}

function addHtmlCodeRanges(state, block, add) {
  const stack = []
  block.cursor().iterate(cursor => {
    if (cursor.name !== 'HTMLTag') return
    const value = state.sliceDoc(cursor.from, cursor.to)
    const tag = inlineCodeTag.exec(value)
    if (!tag || /\/\s*>$/.test(value)) return
    const [, closing, name] = tag
    const kind = name.toLowerCase()
    if (!closing) {
      stack.push({ kind, from: cursor.from })
    } else if (stack.at(-1)?.kind === kind) {
      add(stack.pop().from, cursor.to)
    }
  })
}

function exclusionRanges(state, from, to) {
  const ranges = []
  const add = (start, end) => {
    const clippedFrom = Math.max(start, from)
    const clippedTo = Math.min(end, to)
    if (clippedFrom < clippedTo) ranges.push({ from: clippedFrom, to: clippedTo })
  }
  const tree = syntaxTree(state)
  add(0, yamlFrontMatterEnd(state.doc))
  tree.iterate({ from, to, enter(node) {
    if (excludedNodes.has(node.name)) {
      add(node.from, node.to)
      return false
    }
    if (inlineBlock.test(node.name)) addHtmlCodeRanges(state, node.node, add)
    if (node.name === 'Paragraph' && node.to - node.from <= 65536) {
      for (const match of state.sliceDoc(node.from, node.to).matchAll(blockMath)) {
        add(node.from + match.index, node.from + match.index + match[0].length)
      }
    }
  } })
  const lineFrom = state.doc.lineAt(from).from
  const lineTo = state.doc.lineAt(Math.max(from, to - 1)).to
  const text = state.sliceDoc(lineFrom, lineTo)
  for (const range of technicalSpellcheckRanges(text)) {
    add(lineFrom + range.from, lineFrom + range.to)
  }
  for (const match of text.matchAll(inlineMath)) {
    const start = lineFrom + match.index
    const end = start + match[0].length
    if ((match[1] ?? match[2]).trim() && !codeAt(tree, start) && !codeAt(tree, end - 1)) add(start, end)
  }
  return ranges
}

export function sourceSpellcheckExcluded(state, from, to) {
  return from < to && exclusionRanges(state, from, to).length > 0
}

function sourceDecorations(view) {
  const ranges = view.visibleRanges.flatMap(({ from, to }) => exclusionRanges(view.state, from, to))
    .sort((left, right) => left.from - right.from || left.to - right.to)
  const merged = []
  for (const range of ranges) {
    const last = merged.at(-1)
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to)
    else merged.push(range)
  }
  return Decoration.set(merged.map(({ from, to }) => unchecked.range(from, to)))
}

export const sourceSpellcheckExclusions = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = sourceDecorations(view) }

  update(update) {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
      this.decorations = sourceDecorations(update.view)
    }
  }
}, { decorations: (plugin) => plugin.decorations })

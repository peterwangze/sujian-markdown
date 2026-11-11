import { indentLess, indentMore } from '@codemirror/commands'
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { countColumn, Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'

const continueMarkdown = insertNewlineContinueMarkupCommand({ nonTightLists: false })
const taskPrefix = /^([-+*]|\d{1,9}[.)])([ \t]+)\[[ xX]\](?=[ \t]|$)/

function taskAtCursor(state) {
  const { main, ranges } = state.selection
  if (ranges.length !== 1 || !main.empty) return null
  const line = state.doc.lineAt(main.head)

  for (let node = syntaxTree(state).resolveInner(main.head, -1); node; node = node.parent) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return null
    if (node.name !== 'ListItem') continue
    if (node.from < line.from) return null
    const marker = taskPrefix.exec(state.sliceDoc(node.from, line.to))
    if (!marker || main.head < node.from + marker[0].length) return null
    const end = node.from + marker[0].length
    return {
      empty: !state.sliceDoc(end, line.to).trim(),
      ordered: node.parent.name === 'OrderedList',
      checkbox: end - 3,
      end,
      lineEnd: line.to,
    }
  }
  return null
}

export function continueSourceMarkup({ state, dispatch }) {
  if (state.readOnly) return false
  const task = taskAtCursor(state)
  if (!task) return continueMarkdown({ state, dispatch })

  if (task.empty && (task.ordered || task.end === task.lineEnd)) {
    // Let CodeMirror exit the list and retain its surrounding quote or parent list.
    // It recognizes empty bullets with a trailing space and ordinary ordered markers.
    const changes = task.ordered
      ? { from: task.checkbox, to: task.lineEnd }
      : { from: task.end, insert: ' ' }
    const position = task.ordered ? task.checkbox : task.end + 1
    const prepared = state.update({ changes, selection: { anchor: position } })
    return continueMarkdown({
      state: prepared.state,
      dispatch: next => dispatch(state.update({ changes }, {
        changes: next.changes,
        selection: next.newSelection,
        sequential: true,
        scrollIntoView: true,
        userEvent: 'input',
      })),
    })
  }

  if (!task.ordered) return continueMarkdown({ state, dispatch })

  // CodeMirror preserves the numbering and nesting. Add an unchecked marker to
  // the new ordered item, matching its built-in behavior for task bullets.
  return continueMarkdown({
    state,
    dispatch: next => {
      const position = next.newSelection.main.head
      const checkbox = '[ ] '
      dispatch(state.update({ changes: next.changes }, {
        changes: { from: position, insert: checkbox },
        selection: { anchor: position + checkbox.length },
        sequential: true,
        scrollIntoView: true,
        userEvent: 'input',
      }))
    },
  })
}

const linePrefix = /^(?:[ \t]*>[ \t]?)*[ \t]*/
const leadingSpace = /^[ \t]*/
const markdownTabSize = 4

function lineNode(tree, line, side = 1) {
  return tree.resolveInner(line.from + linePrefix.exec(line.text)[0].length, side)
}

function selectedLines(state) {
  const { from, to, empty } = state.selection.main
  const start = state.doc.lineAt(from)
  const end = state.doc.lineAt(to)
  const last = !empty && end.from === to ? end.number - 1 : end.number
  return Array.from({ length: last - start.number + 1 }, (_, index) => state.doc.line(start.number + index))
}

function previousListItem(item) {
  for (let sibling = item.prevSibling; sibling; sibling = sibling.prevSibling) {
    if (sibling.name === 'ListItem') return sibling
  }
  return null
}

function selectedListItems(tree, lines) {
  const items = []
  for (const line of lines) {
    const last = items.at(-1)
    if (last && line.from < last.to) continue
    if (linePrefix.exec(line.text)[0].length === line.text.length) continue
    let item = lineNode(tree, line)
    while (item && item.name !== 'ListItem') item = item.parent
    if (!item || item.from < line.from || (last && previousListItem(item)?.from !== last.from)) return []
    items.push(item)
  }
  return items
}

function markerPosition(doc, item) {
  const line = doc.lineAt(item.from)
  const start = item.from - line.from
  const prefix = line.text.slice(0, start)
  const quotes = prefix.match(/>/g)?.length ?? 0
  const lastQuote = prefix.lastIndexOf('>')
  const afterQuote = lastQuote < 0 ? 0 : lastQuote + (/^[ \t]/.test(prefix.slice(lastQuote + 1)) ? 2 : 1)
  const column = countColumn(line.text, markdownTabSize, start)
  return { line, column, quotes, afterQuote }
}

function childColumn(doc, item) {
  const { line } = markerPosition(doc, item)
  const end = item.getChild('ListMark').to - line.from
  const after = leadingSpace.exec(line.text.slice(end))[0].length
  const markerEnd = countColumn(line.text, markdownTabSize, end)
  const spaces = countColumn(line.text, markdownTabSize, end + after) - markerEnd
  return markerEnd + (spaces >= 1 && spaces <= 4 ? spaces : 1)
}

function quoteEnd(text, count) {
  let end = 0
  for (let index = 0; index < count; index++) {
    const quote = /^[ \t]*>[ \t]?/.exec(text.slice(end))
    if (!quote) return null
    end += quote[0].length
  }
  return end
}

function changeIndent(line, start, offset, minimum = 0) {
  const end = start + leadingSpace.exec(line.text.slice(start))[0].length
  const current = countColumn(line.text, markdownTabSize, end) - countColumn(line.text, markdownTabSize, start)
  const width = Math.max(Math.min(minimum, current), current + offset)
  if (width === current) return null
  return { from: line.from + start, to: line.from + end, insert: ' '.repeat(width) }
}

function listIndentation(doc, items, outdent) {
  const first = items[0]
  const target = outdent ? first.parent.parent : previousListItem(first)
  if (target?.name !== 'ListItem') return []
  const column = outdent ? markerPosition(doc, target).column : childColumn(doc, target)
  const changes = []
  for (const item of items) {
    const marker = markerPosition(doc, item)
    const last = doc.lineAt(Math.max(item.from, item.to - 1)).number
    for (let number = marker.line.number; number <= last; number++) {
      const line = doc.line(number)
      const start = quoteEnd(line.text, marker.quotes)
      if (start === null || !line.text.slice(start).trim()) continue
      const change = changeIndent(line, start, column - marker.column)
      if (change) changes.push(change)
    }
  }
  return changes
}

function fencedCode(node) {
  for (; node; node = node.parent) if (node.name === 'FencedCode') return node
  return null
}

function codeIndentation(tree, doc, lines, outdent) {
  const changes = []
  for (const line of lines) {
    const node = fencedCode(lineNode(tree, line)) ?? fencedCode(lineNode(tree, line, -1))
    if (!node || node.from >= line.from) return null
    const close = node.lastChild
    if (close?.name === 'CodeMark' && close.from >= line.from && close.from <= line.to) return null
    const marker = markerPosition(doc, node)
    const minimum = marker.column - countColumn(marker.line.text, markdownTabSize, marker.afterQuote)
    const content = quoteEnd(line.text, marker.quotes)
    if (content === null) continue
    const change = changeIndent(line, content, outdent ? -markdownTabSize : markdownTabSize, minimum)
    if (change) changes.push(change)
  }
  return changes
}

export function indentSource({ state, dispatch }, outdent = false) {
  if (state.readOnly) return false
  const fallback = outdent ? indentLess : indentMore
  if (state.selection.ranges.length !== 1) return fallback({ state, dispatch })
  const tree = syntaxTree(state)
  const lines = selectedLines(state)
  const items = selectedListItems(tree, lines)
  const changes = items.length ? listIndentation(state.doc, items, outdent) : codeIndentation(tree, state.doc, lines, outdent)
  if (!changes) return fallback({ state, dispatch })
  if (changes.length) dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'input.indent' }))
  return true
}

export const sourceKeys = Prec.high(keymap.of([
  { key: 'Enter', run: continueSourceMarkup },
  { key: 'Backspace', run: deleteMarkupBackward },
  { key: 'Tab', run: indentSource, shift: view => indentSource(view, true) },
]))

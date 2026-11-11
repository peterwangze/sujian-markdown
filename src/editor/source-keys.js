import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { Prec } from '@codemirror/state'
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

export const sourceKeys = Prec.high(keymap.of([
  { key: 'Enter', run: continueSourceMarkup },
  { key: 'Backspace', run: deleteMarkupBackward },
]))

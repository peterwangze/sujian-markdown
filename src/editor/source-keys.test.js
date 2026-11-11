import assert from 'node:assert/strict'
import { test } from 'node:test'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { continueSourceMarkup } from './source-keys.js'

function pressEnter(sample) {
  let state = EditorState.create({
    doc: sample.replace('|', ''),
    selection: { anchor: sample.indexOf('|') },
    extensions: [markdown({ addKeymap: false })],
  })
  const handled = continueSourceMarkup({ state, dispatch: transaction => { state = transaction.state } })
  const cursor = state.selection.main.head
  return { handled, text: state.sliceDoc(0, cursor) + '|' + state.sliceDoc(cursor) }
}

test('source task continuation resets checked markers and keeps ordered numbering', () => {
  for (const [sample, expected] of [
    ['> - [x] Done|', '> - [x] Done\n> - [ ] |'],
    ['1. [X] Done|\n2. [ ] Later', '1. [X] Done\n2. [ ] |\n3. [ ] Later'],
  ]) {
    assert.deepEqual(pressEnter(sample), { handled: true, text: expected })
  }
})

test('Enter exits empty source tasks and preserves enclosing Markdown', () => {
  for (const [sample, expected] of [
    ['- [x] Done\n- [ ] |', '- [x] Done\n|'],
    ['- [x] Done\n- [ ]|', '- [x] Done\n|'],
    ['> - [ ]|', '> |'],
    ['- Parent\n  - [ ]|', '- Parent\n- |'],
    ['1. [x] Done\n2. [ ]|\n3. [ ] Later', '1. [x] Done\n|\n2. [ ] Later'],
  ]) {
    assert.deepEqual(pressEnter(sample), { handled: true, text: expected })
  }
})

test('task-shaped code stays on the default editing path', () => {
  for (const sample of ['```\n- [ ]|\n```', '    - [ ]|']) {
    assert.deepEqual(pressEnter(sample), { handled: false, text: sample })
  }
})

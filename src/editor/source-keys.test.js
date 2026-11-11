import assert from 'node:assert/strict'
import { test } from 'node:test'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { continueSourceMarkup, indentSource } from './source-keys.js'

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

function pressTab(sample, shift = false) {
  const start = sample.indexOf('|')
  const end = sample.lastIndexOf('|')
  let state = EditorState.create({
    doc: sample.replaceAll('|', ''),
    selection: { anchor: start, head: end === start ? start : end - 1 },
    extensions: [markdown({ addKeymap: false })],
  })
  indentSource({ state, dispatch: transaction => { state = transaction.state } }, shift)
  return state.doc.toString()
}

test('source Tab uses the parent marker width and indents within quotes', () => {
  for (const [original, nested] of [
    ['1. Parent\n2. Child|', '1. Parent\n   2. Child|'],
    ['10. Parent\n11. Child|', '10. Parent\n    11. Child|'],
    ['> - Parent\n> - [x] Child|', '> - Parent\n>   - [x] Child|'],
  ]) {
    assert.equal(pressTab(original), nested.replace('|', ''))
    assert.equal(pressTab(nested, true), original.replace('|', ''))
  }
})

test('source Tab moves selected list items with their contents', () => {
  const original = '- Parent\n|- Child\n  Continuation\n  - Descendant\n- Sibling|\n- Untouched'
  const nested = '- Parent\n  |- Child\n    Continuation\n    - Descendant\n  - Sibling|\n- Untouched'
  assert.equal(pressTab(original), nested.replaceAll('|', ''))
  assert.equal(pressTab(nested, true), original.replaceAll('|', ''))
  assert.equal(pressTab('> - Parent\n> |- Child\n>\n> - Sibling|'), '> - Parent\n>   - Child\n>\n>   - Sibling')
})

test('source Tab shifts fenced code by four columns and keeps its containing markup', () => {
  const original = '> - Parent\n>   ```js\n>   - [ ] Code|\n>   ```'
  const indented = '> - Parent\n>   ```js\n>       - [ ] Code|\n>   ```'
  assert.equal(pressTab(original), indented.replace('|', ''))
  assert.equal(pressTab(indented, true), original.replace('|', ''))
  assert.equal(pressTab(original, true), original.replace('|', ''))
  assert.equal(pressTab('- > ```js\n  >     Code|\n  > ```', true), '- > ```js\n  > Code\n  > ```')
  assert.equal(pressTab('```js\n|\n```'), '```js\n    \n```')
  assert.equal(pressTab('Text|'), '  Text')
})

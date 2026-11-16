import assert from 'node:assert/strict'
import test from 'node:test'
import { buildInlineDiff } from './inline-diff.js'

function assertSpans(before, after, expectedBefore, expectedAfter) {
  const spans = buildInlineDiff(before, after)
  for (const [side, text, expected] of [['before', before, expectedBefore], ['after', after, expectedAfter]]) {
    assert.equal(spans[side].map(span => span.text).join(''), text)
    assert.ok(spans[side].every(span => typeof span.changed === 'boolean' && span.text.length))
    assert.deepEqual(spans[side].filter(span => span.changed).map(span => span.text), expected)
  }
}

test('highlights only changed Chinese characters in a Markdown heading', () => {
  assertSpans('# 当前版 发布计划\n', '# 历史版 发布计划\n', ['当前'], ['历史'])
})

test('compares adjacent code lines using independent word, number and punctuation tokens', () => {
  assertSpans(
    'const timeoutMs = 250;\r\nreturn load();\n',
    'const intervalMs = 500;\r\nreturn load[];\n',
    ['timeoutMs', '250', '()'],
    ['intervalMs', '500', '[]'],
  )
})

test('preserves tabs, trailing spaces and mixed line endings exactly', () => {
  assertSpans(
    '\talpha  \r\nbeta\t\rgamma\n',
    '  alpha\t\r\nbeta \rgamma',
    ['\t', '  ', '\t', '\n'],
    ['  ', '\t', ' '],
  )
  assertSpans('item\r\n', 'item\n', ['\r\n'], ['\n'])
})

test('keeps emoji sequences, skin tones and combining characters intact', () => {
  assertSpans(
    '里程碑验证 👩‍💻 👍🏽 e\u0301\n',
    '里程碑验证 👩‍🚀 👍🏻 e\u0300\n',
    ['👩‍💻', '👍🏽', 'e\u0301'],
    ['👩‍🚀', '👍🏻', 'e\u0300'],
  )
})

test('preserves unchanged content when a multi-line edit adds or removes a line', () => {
  const before = '# 旧值一行\n'
  const after = '# 新值一行\n- 新增一行\n'
  assertSpans(before, after, ['旧'], ['新', '- 新增一行\n'])
  assertSpans(after, before, ['新', '- 新增一行\n'], ['旧'])
})

test('uses one changed span for a pure insertion or deletion and keeps identical text neutral', () => {
  const text = '# 草稿\n\n- 新内容  \r\n'
  assertSpans('', text, [], [text])
  assertSpans(text, '', [text], [])
  assert.deepEqual(buildInlineDiff('', ''), { before: [], after: [] })
  const unchanged = [{ text, changed: false }]
  assert.deepEqual(buildInlineDiff(text, text), { before: unchanged, after: unchanged })
})

test('falls back to whole ranges for unrelated text and over-budget hunks', () => {
  const unrelatedBefore = 'alpha beta gamma\n'
  const unrelatedAfter = 'delta theta omega\n'
  assertSpans(unrelatedBefore, unrelatedAfter, [unrelatedBefore], [unrelatedAfter])

  const largeBefore = '旧'.repeat(1_000_000)
  const largeAfter = '新'.repeat(1_000_000)
  assertSpans(largeBefore, largeAfter, [largeBefore], [largeAfter])

  const shared = '相同'.repeat(50)
  const divergentBefore = shared + '旧'.repeat(40)
  const divergentAfter = shared + '新'.repeat(40)
  assertSpans(divergentBefore, divergentAfter, [divergentBefore], [divergentAfter])
})

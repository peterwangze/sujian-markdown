import assert from 'node:assert/strict'
import test from 'node:test'
import { applyReview, buildReview } from './model.js'

test('applies a selected range without changing untouched Markdown or mixed line endings', () => {
  const base = '# 标题\r\n\r\n正文 🌱  \n\n| 项目 |\r| 原表格 |'
  const candidate = base.replace('正文 🌱', '修订 🌱').replace('原表格', '候选表格')
  const review = buildReview(base, base, candidate)

  assert.equal(review.changes.length, 2)
  assert.deepEqual(review.changes.map(({ line, status }) => [line, status]), [[3, 'ready'], [6, 'ready']])
  assert.equal(applyReview(review, [review.changes[0].id]), base.replace('正文 🌱', '修订 🌱'))
  assert.equal(applyReview(review, new Set(review.changes.map(change => change.id))), candidate)
  assert.equal(applyReview(review, []), base)
})

test('merges independent local edits and retains CRLF in untouched ranges', () => {
  const base = '顶部\r\n内容\r\n底部'
  const current = '我的补充\r\n我的标题\r\n内容\r\n底部'
  const candidate = '顶部\r\nAI 建议\r\n底部'
  const review = buildReview(base, current, candidate)
  const [change] = review.changes

  assert.equal(change.status, 'ready')
  assert.equal(change.current, '内容\r\n')
  assert.equal(applyReview(review, [change.id]), '我的补充\r\n我的标题\r\nAI 建议\r\n底部')
})

test('a concurrent change to the same line is blocked and shows all three texts', () => {
  const base = '前\n发布说明\n后\n'
  const review = buildReview(base, base.replace('发布说明', '我的说明'), base.replace('发布说明', 'AI 说明'))
  const [change] = review.changes

  assert.deepEqual([change.before, change.current, change.after, change.status], ['发布说明\n', '我的说明\n', 'AI 说明\n', 'conflict'])
  assert.throws(() => applyReview(review, [change.id]), /冲突/)
  assert.throws(() => applyReview(review, ['missing']), /不属于/)
})

test('zero-width insertions detect competing edits at the same point or adjacent edge', () => {
  const base = '前\n后\n'
  const candidate = '前\nAI 插入\n后\n'
  const clean = buildReview(base, base, candidate)
  assert.equal(clean.changes[0].before, '')
  assert.equal(applyReview(clean, [clean.changes[0].id]), candidate)

  const samePoint = buildReview(base, '前\n用户插入\n后\n', candidate).changes[0]
  assert.equal(samePoint.status, 'conflict')
  assert.equal(samePoint.current, '用户插入\n')

  const adjacent = buildReview(base, '前\n用户编辑\n', candidate).changes[0]
  assert.equal(adjacent.status, 'conflict')
  assert.equal(adjacent.current, '用户编辑\n')
})

test('already applied changes and repeated selections do not duplicate inserted text', () => {
  const base = '# Heading\n\nEnd\n'
  const candidate = base + 'Extra\n'
  const initial = buildReview(base, base, candidate)
  const id = initial.changes[0].id
  assert.equal(applyReview(initial, [id, id]), candidate)

  const next = buildReview(base, candidate.replace('Heading', 'My Heading'), candidate)
  assert.equal(next.changes[0].id, id)
  assert.equal(next.changes[0].status, 'already-applied')
  assert.throws(() => applyReview(next, [id]), /已经应用/)
  assert.equal(applyReview(next, []), next.currentText)
})

test('repeated headings are resolved by position and context instead of name', () => {
  const base = '# 记录\n第一条\n\n# 记录\n第二条\n'
  const current = base.replace('第一条', '已更新第一条')
  const candidate = base.replace('第二条', '候选第二条')
  const review = buildReview(base, current, candidate)
  const [change] = review.changes

  assert.equal(change.line, 5)
  assert.equal(change.status, 'ready')
  assert.equal(applyReview(review, [change.id]), current.replace('第二条', '候选第二条'))
})

test('handles an empty original or candidate, including an intentional full deletion', () => {
  const insertion = buildReview('', '', '正文\r\n')
  assert.equal(insertion.changes[0].line, 1)
  assert.equal(applyReview(insertion, [insertion.changes[0].id]), '正文\r\n')

  const deletion = buildReview('正文', '正文', '')
  assert.equal(applyReview(deletion, [deletion.changes[0].id]), '')
  assert.equal(buildReview('', '', '').changes.length, 0)
})

test('refuses comparisons above the document size limit', () => {
  assert.throws(() => buildReview('', '', 'x'.repeat(2_000_001)), RangeError)
  assert.throws(() => buildReview('', '', '\n'.repeat(80_001)), RangeError)
})

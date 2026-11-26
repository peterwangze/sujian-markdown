import assert from 'node:assert/strict'
import test from 'node:test'
import { headings } from './text.js'

const titles = markdown => headings(markdown).map(({ title }) => title)
const frontMatter = ['---', 'doc_id: DOCS-INDEX', 'status: draft', 'owner: Coordinator', 'last_updated: 2026-11-26',
  'requirements: [GM-REQ-01, GM-REQ-02, GM-REQ-03, GM-REQ-04, GM-REQ-05, GM-REQ-06, GM-REQ-07, GM-REQ-08, GM-REQ-09, GM-REQ-10, GM-REQ-11, GM-REQ-12]', '---']

test('headings are read from both ways of writing them, outside code', () => {
  const markdown = ['# 标题', '', 'Paragraph', '==========', '', '## 子章节', '', '```md', '# Not a heading', 'Title', '---', '```', '', 'Other', '---', ''].join('\n')
  assert.deepEqual(headings(markdown), [
    { depth: 1, title: '标题', line: 1 },
    { depth: 1, title: 'Paragraph', line: 3 },
    { depth: 2, title: '子章节', line: 6 },
    { depth: 2, title: 'Other', line: 14 },
  ])
})

test('the metadata at the start of a document is not a heading', () => {
  const markdown = [...frontMatter, '', '# Earth Online Game Master – 设计文档', '', '## 阅读路径', '', '## 变更记录', ''].join('\n')
  assert.deepEqual(headings(markdown), [
    { depth: 1, title: 'Earth Online Game Master – 设计文档', line: 9 },
    { depth: 2, title: '阅读路径', line: 11 },
    { depth: 2, title: '变更记录', line: 13 },
  ])
})

test('headings after the metadata keep their lines', () => {
  const markdown = [...frontMatter, 'Title', '===', '', 'Second', '---', ''].join('\n')
  assert.deepEqual(headings(markdown), [
    { depth: 1, title: 'Title', line: 8 },
    { depth: 2, title: 'Second', line: 11 },
  ])
})

test('the metadata may have blank lines before it, indentation and Windows line ends', () => {
  const markdown = '\r\n  ---\r\nstatus: draft\r\n   --- \r\n\r\n# 标题\r\n\r\n小节\r\n---\r\n'
  assert.deepEqual(headings(markdown), [{ depth: 1, title: '标题', line: 6 }, { depth: 2, title: '小节', line: 8 }])
})

test('what looks like metadata is read as Markdown when it is not closed or not first', () => {
  assert.deepEqual(titles('---\n\n# 标题\n\n## 小节\n'), ['标题', '小节'])
  assert.deepEqual(titles('---'), [])
  assert.deepEqual(titles('---\n----\n# 标题\n'), ['标题'])
  assert.deepEqual(titles('+++\ntitle = "x"\n+++\n\n# 标题\n'), ['标题'])
  assert.deepEqual(titles('{\n"a": 1\n}\n\n# 标题\n'), ['标题'])
  // Dashes after a heading separate sections. The line above them is a heading of its own.
  assert.deepEqual(headings('# 一\n\n---\nstatus: draft\n---\n\n# 二\n'), [
    { depth: 1, title: '一', line: 1 },
    { depth: 2, title: 'status: draft', line: 4 },
    { depth: 1, title: '二', line: 7 },
  ])
})

test('dashes and heading markers inside the metadata are not headings', () => {
  const markdown = [...frontMatter.slice(0, 2), '# Not a heading', 'Title', '===', '- list', '```', 'code', '```', '---', '', '## Real', ''].join('\n')
  assert.deepEqual(headings(markdown), [{ depth: 2, title: 'Real', line: 12 }])
})

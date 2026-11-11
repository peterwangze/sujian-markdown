import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectSpecs, relativeSourcePath, sourceLine, workflowTemplates } from './workflows.js'

test('creates portable source paths on Windows, UNC shares and POSIX', () => {
  assert.equal(relativeSourcePath('D:\\项目\\笔记\\纪要.md', 'd:\\项目\\材料\\访谈 (1)#.md'),
    '../%E6%9D%90%E6%96%99/%E8%AE%BF%E8%B0%88%20%281%29%23.md')
  assert.equal(relativeSourcePath('\\\\host\\share\\doc.md', '\\\\HOST\\share\\ref.md'), 'ref.md')
  assert.equal(relativeSourcePath('/tmp/work/note.md', '/tmp/work/ref.md'), 'ref.md')
  assert.equal(relativeSourcePath('D:\\note.md', 'C:\\ref.md'), null)
  assert.equal(relativeSourcePath('/tmp/work/note.md', 'ref.md'), null)
  assert.equal(sourceLine('L12-L14'), 12)
  assert.equal(sourceLine('L0'), null)
  assert.equal(sourceLine('example-L1'), null)
})

test('checks requirement coverage, duplicates and evidence without treating fenced examples as tasks', () => {
  const docs = [
    { id: 'spec', name: 'spec.md', text: [
      '# 规格', '## REQ-001 已关联', '## REQ-002 待关联',
      '```md', '## REQ-777 示例', '```',
    ].join('\n') },
    { id: 'tasks', name: 'tasks.md', text: [
      '## TASK-001 验证', '- 验收项：REQ-001、REQ-777', '- 证据：[日志](log.md#L12)',
      '## TASK-001 重复', '- 证据：待填写',
    ].join('\n') },
  ]
  const result = inspectSpecs(docs)
  assert.equal(result.count, 4)
  assert.deepEqual(result.issues.map(item => [item.docId, item.line, item.message]), [
    ['tasks', 4, '编号重复 · TASK-001'],
    ['tasks', 1, 'TASK-001 引用了未找到的 REQ-777'],
    ['tasks', 4, 'TASK-001 缺少验收项编号'],
    ['tasks', 4, 'TASK-001 缺少测试证据链接'],
    ['spec', 3, 'REQ-002 尚未关联任务'],
  ])
})

test('keeps the bundled requirements template connected and flags its unfinished evidence', () => {
  const docs = workflowTemplates[0].documents.map(doc => ({ ...doc, id: doc.name }))
  assert.equal(inspectSpecs(docs).count, 2)
  assert.deepEqual(inspectSpecs(docs).issues.map(issue => issue.message), ['TASK-001 缺少测试证据链接'])
})

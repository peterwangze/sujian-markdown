import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-outline-'))
const profile = path.join(working, 'profile')
const root = path.join(working, '项目')
const file = path.join(root, '设计文档.md')
const requirements = Array.from({ length: 12 }, (_, index) => `GM-REQ-${String(index + 1).padStart(2, '0')}`)
// A document that opens with metadata. Its last line ends where the dashes begin.
const lines = ['---', 'doc_id: DOCS-INDEX', 'status: draft', 'owner: Coordinator', 'last_updated: 2026-11-26',
  `requirements: [${requirements.join(', ')}]`, '---', '', '# Earth Online Game Master – 设计文档', '', '## 阅读路径', '',
  '先读产品定义，再读设计。', '', '## 文档地图', '', '| 文件夹 | 内容 |', '| --- | --- |', '| research/ | 调研 |', '',
  ...Array.from({ length: 40 }, (_, index) => `填充段落 ${index}，用来把后面的标题推出窗口。`), '', '## 变更记录', '',
  '| 日期 | 修改 |', '| --- | --- |', '2026-11-26 | 初稿 |', '', '本文档由协调者维护。']
const original = lines.join('\n') + '\n'
await Promise.all([mkdir(profile), mkdir(root)])
await Promise.all([
  writeFile(file, original),
  writeFile(path.join(profile, 'preferences.json'), JSON.stringify({ workspace: root, sidebar: true, mode: 'live' })),
])

const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + profile]
if (!executablePath) args.push(project)
const app = await _electron.launch({ args: [...args, file], ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
const ir = page.locator('.editor-live .vditor-ir > .vditor-reset')
const sidebar = () => page.getByRole('complementary', { name: '文件与大纲' })
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const entry = name => button(name, sidebar())
const outline = () => page.locator('.outline-row [data-sidebar-row]').evaluateAll(rows => rows.map(row =>
  ({ title: row.title, indent: row.parentElement.style.getPropertyValue('--indent') })))
const titles = ['Earth Online Game Master – 设计文档', '阅读路径', '文档地图', '变更记录']
const listed = titles.map((title, index) => ({ title, indent: index ? '1' : '0' }))
page.setDefaultTimeout(12000)

try {
  await page.waitForSelector('.application[data-ready="true"]')
  await button('大纲').click()
  await entry('变更记录').waitFor()
  // The editor shows the metadata as one block, and the outline leaves it out.
  assert.equal(await page.locator('.editor-live .vditor-ir > .vditor-reset > [data-type="yaml-front-matter"]').count(), 1)
  assert.deepEqual(await outline(), listed)
  assert.equal(await page.locator('.outline-row', { hasText: 'GM-REQ' }).count(), 0)

  // Choosing an entry moves the caret into its heading.
  const below = name => page.evaluate(name => {
    const heading = Array.from(document.querySelectorAll('.editor-live .vditor-ir > .vditor-reset h2'))
      .find(element => element.textContent.replace(/#/g, '').trim() === name)
    return heading.getBoundingClientRect().top >= innerHeight
  }, name)
  assert.ok(await below('变更记录'))
  await entry('变更记录').click()
  await page.waitForFunction(name => {
    const selection = getSelection()
    const anchor = selection.anchorNode
    const heading = (anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement).closest('h2')
    if (!heading || !selection.isCollapsed) return false
    const rect = heading.getBoundingClientRect()
    return heading.textContent.replace(/#/g, '').trim() === name && rect.top >= 0 && rect.bottom <= innerHeight
  }, '变更记录')

  // The same outline in source mode, where a chosen entry is the active line.
  await button('源码').click()
  await page.locator('.cm-line').filter({ hasText: '## 阅读路径' }).waitFor()
  assert.deepEqual(await outline(), listed)
  await entry('阅读路径').click()
  await page.waitForFunction(() => document.querySelector('.cm-activeLine')?.textContent === '## 阅读路径')

  // Without its closing dashes the block is ordinary text. Its headings stay, and nothing else joins them.
  await page.locator('.cm-line').filter({ hasText: /^---$/ }).nth(1).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Shift+Home')
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => document.querySelector('.cm-activeLine')?.textContent === '')
  assert.deepEqual((await outline()).map(item => item.title), titles)
  assert.equal(await page.locator('.outline-row', { hasText: 'GM-REQ' }).count(), 0)
  await page.keyboard.type('---')
  await page.waitForFunction(() => document.querySelector('.cm-activeLine')?.textContent === '---')
  assert.deepEqual((await outline()).map(item => item.title), titles)

  // A heading typed in live mode is listed at its depth, and its line is counted past the metadata.
  await button('即时').click()
  await ir.locator('h1').waitFor()
  await ir.evaluate(editor => {
    const range = document.createRange()
    range.selectNodeContents(editor.lastElementChild)
    range.collapse()
    document.getSelection().removeAllRanges()
    document.getSelection().addRange(range)
  })
  await page.keyboard.press('Enter')
  for (let mark = 0; mark < 3; mark += 1) await page.keyboard.press('Shift+Digit3')
  await page.keyboard.press('Space')
  await page.keyboard.insertText('新增小节')
  await entry('新增小节').waitFor()
  assert.deepEqual(await outline(), [...listed, { title: '新增小节', indent: '2' }])
  await button('源码').click()
  await page.locator('.cm-line').filter({ hasText: '### 新增小节' }).waitFor()
  await entry('新增小节').click()
  await page.waitForFunction(() => document.querySelector('.cm-activeLine')?.textContent === '### 新增小节')
  const unsaved = page.getByRole('tab').filter({ hasText: '设计文档.md' }).locator('[title="有未保存的改动"]')
  await unsaved.waitFor({ state: 'attached' })
  await button('文档与视图').click()
  await button('保存', page.locator('.tool-menu-list')).click()
  await unsaved.waitFor({ state: 'detached' })
  await page.getByRole('contentinfo').getByText('已保存', { exact: true }).waitFor()
  assert.equal(await readFile(file, 'utf8'), original + '\n### 新增小节\n')
  console.log('Passed the outline of a document with metadata in live and source mode, its jumps, and a heading typed at the end.')
} finally {
  await app.close()
}

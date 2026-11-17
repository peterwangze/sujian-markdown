import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const folder = await mkdtemp(path.join(tmpdir(), 'sujian-document-find-'))
const profile = path.join(folder, 'profile')
const target = path.join(folder, '文档查找.md')
const other = path.join(folder, '其他文档.md')
const original = [
  '# 针对 needle 查找', '',
  '正文 Needle，needle，needles。', '',
  '- 列表 needle，左**亮词**右。', '',
  '| 列头 | 内容 |', '| --- | --- |', '| needle | 列表项 |', '',
  '```js', 'const needle = 42;', '```', '',
  '[链接](https://example.test/needle) 中的可见 needle。', '',
  '远处跳转起点。', '', ...Array.from({ length: 50 }, (_, index) => `稳定段落 ${index + 1}。\n`), '远处跳转终点。', '',
].join('\n')
await mkdir(profile)
await Promise.all([
  writeFile(path.join(profile, 'preferences.json'), JSON.stringify({ mode: 'source', resume: false })),
  writeFile(target, original), writeFile(other, '# 另一篇\n\n只有一个 needle。\n'),
])

const executablePath = process.env.SUJIAN_QA_EXE
const args = [`--user-data-dir=${profile}`, ...(executablePath ? [] : [project]), target, other]
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(10_000)
const mac = process.platform === 'darwin'
const button = name => page.getByRole('button', { name, exact: true })
const tab = name => page.getByRole('tab').filter({ hasText: name })
const find = page.getByRole('textbox', { name: '查找文字', exact: true })
const count = page.locator('.match-count')
const sourceMark = page.locator('.cm-content .editor-find-match')
const sourceCurrent = page.locator('.cm-content .editor-find-current')
const readPreview = page.locator('.editor-mode-read .editor-preview')
const liveBody = page.getByLabel('Markdown 即时编辑', { exact: true })

async function untilCount(value) {
  await count.getByText(value, { exact: true }).waitFor()
}

async function renderedMark() {
  return page.evaluate(() => ['sujian-find-current', 'sujian-find-match'].map(name =>
    [...(CSS.highlights.get(name) ?? [])].map(range => range.toString())))
}

async function mode(name) {
  await button('文档与视图').click()
  await button(name).click()
}

try {
  await page.waitForSelector('.application[data-ready="true"]')
  await tab('文档查找.md').click()
  await page.locator('.cm-line').filter({ hasText: '远处跳转起点。' }).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await app.evaluate(({ BrowserWindow }, modifier) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.focus()
    for (const type of ['keyDown', 'keyUp']) window.webContents.sendInputEvent({ type, keyCode: 'F', modifiers: [modifier] })
  }, mac ? 'meta' : 'control')
  await find.waitFor()
  assert.equal(await find.inputValue(), '远处跳转起点。')
  await untilCount('1 / 1')
  await find.fill('needle')
  await untilCount('1 / 9')
  assert.equal(await sourceCurrent.textContent(), 'needle')
  assert.ok(await sourceMark.count() >= 3)
  await find.press('Shift+Enter')
  await untilCount('9 / 9')
  await find.press('F3')
  await untilCount('1 / 9')
  await find.press('Enter')
  await untilCount('2 / 9')
  await find.press('Shift+F3')
  await untilCount('1 / 9')
  assert.ok(await find.evaluate(input => input === document.activeElement))
  await page.getByLabel('全词', { exact: true }).check()
  await untilCount('1 / 8')
  await page.getByLabel('区分大小写', { exact: true }).check()
  await untilCount('1 / 7')
  await page.getByLabel('正则表达式', { exact: true }).check()
  await find.fill('[')
  await untilCount('正则表达式无效')
  assert.equal(await sourceCurrent.count(), 0)
  assert.equal(await sourceMark.count(), 0)
  await page.getByLabel('正则表达式', { exact: true }).uncheck()
  await page.getByLabel('区分大小写', { exact: true }).uncheck()
  await page.getByLabel('全词', { exact: true }).uncheck()
  await find.fill('needle')
  await untilCount('1 / 9')
  await tab('其他文档.md').click()
  await untilCount('1 / 1')
  assert.equal(await sourceMark.count(), 0)
  await find.press('Escape')
  await tab('文档查找.md').click()
  assert.equal(await sourceCurrent.count(), 0)
  assert.equal(await sourceMark.count(), 0)
  await button('查找').click()
  await find.fill('needle')
  await untilCount('1 / 9')

  await mode('分栏预览')
  const splitPreview = page.locator('.editor-mode-split .editor-preview')
  await splitPreview.getByRole('heading', { level: 1 }).waitFor()
  assert.equal(await sourceCurrent.textContent(), 'needle')
  assert.ok((await renderedMark())[1].includes('needle'))
  await mode('阅读模式')
  await readPreview.getByRole('heading', { level: 1 }).waitFor()
  await untilCount('1 / 8')
  assert.equal(await button('替换').count(), 0)
  await find.fill('左亮词右')
  await untilCount('1 / 1')
  assert.deepEqual((await renderedMark())[0], ['左', '亮词', '右'])
  assert.equal(await readPreview.locator('strong').textContent(), '亮词')
  await find.fill('远处跳转')
  await untilCount('1 / 2')
  assert.equal(await readPreview.evaluate(view => view.scrollTop < view.clientHeight), true)
  await find.press('Enter')
  await untilCount('2 / 2')
  await readPreview.evaluate(view => {
    const current = [...CSS.highlights.get('sujian-find-current')][0].getBoundingClientRect()
    const viewport = view.getBoundingClientRect()
    if (!(view.scrollTop > view.clientHeight && current.top >= viewport.top && current.bottom <= viewport.bottom)) {
      throw new Error('Current reading-mode match did not scroll into view.')
    }
  })
  assert.equal(await find.evaluate(input => input === document.activeElement), true)
  await find.fill('左亮词右')
  await untilCount('1 / 1')

  await button('即时').click()
  await liveBody.locator('strong').waitFor()
  await untilCount('1 / 1')
  assert.deepEqual((await renderedMark())[0], ['左', '亮词', '右'])
  if (process.env.SUJIAN_FIND_SCREENSHOT) {
    await find.fill('needle')
    await count.getByText(/1 \/ [78]/).waitFor()
    await page.screenshot({ path: process.env.SUJIAN_FIND_SCREENSHOT })
  }
  await button('清空查找').click()
  assert.equal(await find.inputValue(), '')
  await page.waitForFunction(() => !CSS.highlights.has('sujian-find-current') && !CSS.highlights.has('sujian-find-match'))
  await find.fill('needle。')
  await untilCount('1 / 1')
  await button('替换').click()
  await page.getByRole('textbox', { name: '替换为', exact: true }).fill('命中的词。')
  await button('替换一处').click()
  await liveBody.getByText('中的可见 命中的词。', { exact: false }).waitFor()
  await find.press('Escape')
  await find.waitFor({ state: 'detached' })
  assert.deepEqual(await renderedMark(), [[], []])
  await button('源码').click()
  const changedLine = page.locator('.cm-line').filter({ hasText: '中的可见 命中的词。' })
  await changedLine.waitFor()
  assert.equal(await changedLine.textContent(), '[链接](https://example.test/needle) 中的可见 命中的词。')
  await button('文档与视图').click()
  await button('保存').click()
  await page.locator('.statusbar').getByText('已保存', { exact: true }).waitFor()
  assert.equal(await readFile(target, 'utf8'), original.replace('可见 needle。', '可见 命中的词。'))
  console.log('Document find verified immediate counts, navigation/wrap, flags/invalid regex, cross-tab cleanup, split, read, live cross-format matches, clear/Escape, and safe replacement around a hidden link destination.')
} finally {
  await app.close()
}

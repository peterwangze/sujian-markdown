import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { waitForCheck } from './desktop-checks.mjs'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
// Long documents would freeze the editor for seconds per key. The limits are
// generous: they tell a freeze from a slow machine.
const freeze = 1500
const opening = 5000

// A document with headings, paragraphs in two scripts, lists, tables and code.
function unit(index) {
  return [
    `## 第 ${index} 节 标题 Title ${index}`, '',
    `这是第 ${index} 段用于性能测试的中文正文，包含 English words、数字 ${index * 7919} 与标点。The quick brown fox jumps over the lazy dog, and the reader keeps scrolling through a long document to check how it responds.`,
    '',
    `- 列表项 ${index}：说明文字 with **bold** and *italic*`,
    `- 第二项，包含 \`inline code\` 与 [链接](https://example.com/${index})`, '',
    '| 列 A | 列 B | 列 C |', '| --- | --- | --- |', `| ${index} | 数据 data | 说明 note |`, '',
    '```js', `function compute${index}(value) {`, `  return value * ${index} + 1; // 注释`, '}', '```', '',
  ].join('\n')
}
function document(characters) {
  let text = ''
  for (let index = 1; text.length < characters; index += 1) text += unit(index)
  // It ends with a paragraph, so that the end of the document is plain text.
  return text + '\n这是文档结尾的段落，用于检查在文末输入。\n'
}

const large = document(150_000)
const longest = document(260_000)
const paragraph = /这是第 100 段[^\n]*/.exec(large)[0]
const working = await mkdtemp(path.join(tmpdir(), 'sujian-large-document-'))
const profile = path.join(working, 'profile')
const folder = path.join(working, '长文档')
await Promise.all([mkdir(profile), mkdir(folder)])
await Promise.all([
  writeFile(path.join(profile, 'preferences.json'), JSON.stringify({ workspace: folder, sidebar: true, mode: 'live' })),
  writeFile(path.join(folder, 'large.md'), large),
  writeFile(path.join(folder, 'longest.md'), longest),
])

const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + profile, ...(executablePath ? [] : [project])]
let app, page
const sidebar = () => page.getByRole('complementary', { name: '文件与大纲' })
const row = name => sidebar().getByRole('button', { name, exact: true }).and(sidebar().locator('[data-sidebar-row]'))
const tab = name => page.getByRole('tab', { name, exact: true })
const live = () => page.locator('.editor-live .vditor-ir > .vditor-reset')
const painted = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

async function launch() {
  app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
  page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  await page.waitForSelector('.application[data-ready="true"]')
}

// Opens a document and returns the time until it is on screen.
async function open(name, ready) {
  const before = Date.now()
  await row(name).click()
  await page.waitForFunction(ready)
  await painted()
  return Date.now() - before
}

async function menu(name) {
  await page.getByRole('button', { name: '文档与视图', exact: true }).click()
  await page.locator('.tool-menu-list').getByRole('button', { name, exact: true }).click()
}

// Saves the open document and waits until it has no unsaved changes.
async function save(name) {
  await menu('保存')
  await tab(name).locator('[title="有未保存的改动"]').waitFor({ state: 'detached' })
}

// The browser reports how long each key kept the page busy, from its arrival
// until the frame after it.
const keys = []
let seen = 0
async function key(name) {
  await page.keyboard.press(name)
  await page.waitForTimeout(400)
  const entries = await page.evaluate(from => globalThis.__timed.slice(from), seen)
  seen += entries.length
  const duration = entries.length ? Math.max(...entries.map(([, duration]) => duration)) : 16
  keys.push([name, duration])
}

// The end of paragraph 100, where the keys go; the block the caret is in;
// and the end of the document.
const state = () => page.evaluate(() => {
  const reset = document.querySelector('.editor-live .vditor-ir > .vditor-reset')
  const hundred = [...reset.querySelectorAll('p')].find(node => node.textContent.startsWith('这是第 100 段'))
  const caret = window.getSelection().anchorNode?.parentElement?.closest('p, h1, h2, h3, h4, h5, h6, li, td')?.textContent ?? ''
  return [hundred.textContent.slice(-11), caret.replaceAll(String.fromCharCode(0x200b), '').replace(/\s/g, '').slice(-11), reset.lastElementChild.textContent.slice(-12)]
})
async function caretAtHundred() {
  await page.evaluate(() => {
    const hundred = [...document.querySelectorAll('.editor-live .vditor-ir > .vditor-reset p')].find(node => node.textContent.startsWith('这是第 100 段'))
    const range = document.createRange()
    range.selectNodeContents(hundred)
    range.collapse(false)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    hundred.scrollIntoView({ block: 'center' })
    document.querySelector('.editor-live .vditor-ir').focus()
  })
  await page.evaluate(() => {
    globalThis.__timed = []
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) globalThis.__timed.push([Math.round(entry.startTime), Math.round(entry.duration)])
    }).observe({ type: 'event', durationThreshold: 16 })
  })
}

try {
  await launch()
  const opened = await open('large.md', () => document.querySelectorAll('.editor-live .vditor-reset > *').length > 1000)
  assert.ok(opened < opening, `Opening the large document took ${opened} ms`)
  // The editor makes itself ready for editing while nothing else is going on.
  await page.waitForTimeout(4000)
  console.log(`A document of ${large.length} characters opens in ${opened} ms.`)

  await caretAtHundred()
  assert.match(await page.evaluate(() => window.getSelection().anchorNode?.textContent ?? ''), /how it responds.$/)
  await key('x')
  assert.match((await state())[0], /responds.x$/)
  // Vditor records a step a moment after a key; undo must wait for it.
  await page.waitForTimeout(800)
  await key('Control+z')
  assert.match((await state())[0], /responds.$/)
  await key('Control+y')
  assert.match((await state())[0], /responds.x$/)
  await key('y')
  assert.match((await state())[0], /responds.xy$/)
  await key('Enter')
  const entered = await state()
  assert.match(entered[0], /responds.xy$/)
  assert.equal(entered[1], '')
  await key('Backspace')
  await key('Backspace')
  const merged = await state()
  assert.match(merged[0], /responds.x$/)
  assert.match(merged[1], /responds.x$/)

  // The end of the document.
  await page.keyboard.press('Control+End')
  for (const letter of 'end') await key(letter)
  assert.match((await state())[2], /在文末输入。end$/)
  const times = keys.map(([, duration]) => duration).sort((left, right) => left - right)
  const median = times[Math.floor(times.length / 2)]
  const slowest = times.at(-1)
  console.log('Keys and their durations: ' + keys.map(([name, duration]) => `${name} ${duration}`).join(', '))
  assert.ok(slowest < freeze, `A key took ${slowest} ms`)
  console.log(`Typing, undoing and redoing take a median of ${median} ms per key and at most ${slowest} ms.`)

  await save('large.md')
  const expected = large.replace(paragraph, paragraph + 'x').replace(/\n$/, 'end\n')
  const saved = await readFile(path.join(folder, 'large.md'), 'utf8')
  assert.equal(saved, expected)
  console.log('The saved document differs from the original exactly by what was typed, in the middle and at the end.')

  // A document longer than the live editor takes opens in the source editor,
  // which shows what fits on screen; the end is reached through the keyboard.
  const source = await open('longest.md', () => document.querySelector('.cm-content')?.children.length > 0)
  assert.ok(source < opening, `Opening the longest document took ${source} ms`)
  assert.equal(await page.locator('.editor-live').isVisible(), false)
  await page.locator('.large-note').waitFor()
  await page.locator('.cm-content').press('Control+End')
  await page.locator('.cm-content').press('z')
  await save('longest.md')
  assert.equal(await readFile(path.join(folder, 'longest.md'), 'utf8'), longest + 'z')
  console.log(`A document of ${longest.length} characters opens in the source editor in ${source} ms and takes typing.`)

  // What was saved is what opens again.
  await app.close()
  await launch()
  await tab('large.md').click()
  await live().locator(':scope > p').first().waitFor()
  assert.match((await state())[0], /responds.x$/)
  assert.match((await state())[2], /在文末输入。end$/)
  console.log('The document opens again with what was typed.')
  console.log('Acceptance artifacts: ' + working)
} finally {
  await app.close().catch(() => {})
}

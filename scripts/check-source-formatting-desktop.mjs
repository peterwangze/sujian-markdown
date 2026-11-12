import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-source-formatting-'))
const file = path.join(working, '源码格式.md')
const modes = ['源码', '分栏预览']
const contexts = [
  ['heading', (word) => `## Before ${word} after\n`],
  ['paragraph', (word) => `Before ${word} after\n`],
  ['quoted', (word) => `> Before ${word} after\n`],
  ['bullet', (word) => `- Before ${word} after\n`],
  ['numbered', (word) => `1. Before ${word} after\n`],
  ['task', (word) => `- [x] Before ${word} after\n`],
  ['table', (word) => `| 内容 | 状态 |\n| --- | --- |\n| Before ${word} after | Ready |\n`],
]
const formats = [
  ['加粗', 'strong', (word) => ` **${word}** `],
  ['斜体', 'em', (word) => ` *${word}* `],
  ['删除线', 'del, s', (word) => ` ~~${word}~~ `],
  ['行内代码', 'code', (word) => `\`  ${word}  \``],
]
const cases = modes.flatMap((mode, index) => contexts.map(([context, wrap], caseIndex) => {
  const [command, tag, mark] = formats[(index + caseIndex) % formats.length]
  const word = `示例${context}${index + 1}`
  return { mode, word, command, tag, expected: mark(word), fixture: wrap(word) }
}))
const crossBlock = [
  'Cross block prose', '', '## Cross block heading', '', '> Cross block quote',
  '', '- [x] Cross block task', '', '~~~js', 'const keepLiteral = 1;', '~~~', '', 'Cross block tail',
].join('\n') + '\n'
const original = cases.map(({ fixture }) => fixture).join('\n') + '\n' + crossBlock
await writeFile(file, original)
const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + path.join(working, 'profile')]
if (!executablePath) args.push(project)
args.push(file)
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(10000)
const source = page.getByLabel('Markdown 源码')
const preview = page.locator('.editor-preview')
const button = (name) => page.getByRole('button', { name, exact: true })

async function action(name) {
  await button('文档与视图').click()
  await page.locator('.tool-menu-list').getByRole('button', { name, exact: true }).click()
}

async function pointsAt(line, phrase) {
  await line.scrollIntoViewIfNeeded()
  return line.evaluate((element, phrase) => {
    const start = element.textContent.indexOf(phrase)
    const finish = start + phrase.length
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let offset = 0
    const points = {}
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const [name, index] of [['left', start], ['right', finish]]) {
        if (points[name] || index < offset || index > offset + node.length) continue
        const range = document.createRange()
        range.setStart(node, index - offset)
        range.collapse(true)
        const rect = range.getBoundingClientRect()
        points[name] = { x: rect.x, y: (rect.top + rect.bottom) / 2 }
      }
      offset += node.length
    }
    return points
  }, phrase)
}

async function formatFromSelection({ word, command, expected }, backward) {
  const line = source.locator('.cm-line').filter({ hasText: word })
  const selected = ' ' + word + ' '
  const { left, right } = await pointsAt(line, selected)
  const [start, end] = backward ? [right, left] : [left, right]
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()
  await page.mouse.click((start.x + end.x) / 2, start.y, { button: 'right' })
  const menu = page.getByRole('menu')
  assert.equal(await menu.getAttribute('data-selection'), 'true')
  await menu.getByRole('menuitem', { name: command, exact: true }).click()
  assert.ok((await line.textContent()).includes(expected), `${word} ${command}: ${await line.textContent()}`)
}

try {
  await page.waitForSelector('.application[data-ready="true"]')
  for (const mode of modes) {
    if (mode === '源码') await button(mode).click()
    else await action(mode)
    for (const [index, sample] of cases.filter(item => item.mode === mode).entries()) {
      await formatFromSelection(sample, index % 2 !== 0)
    }
  }
  for (const { word, tag } of cases) await preview.locator(tag).filter({ hasText: word }).waitFor()
  const first = source.locator('.cm-line').filter({ hasText: 'Cross block prose' })
  const last = source.locator('.cm-line').filter({ hasText: 'Cross block tail' })
  await last.scrollIntoViewIfNeeded()
  const start = (await pointsAt(first, 'Cross block prose')).left
  const end = (await pointsAt(last, 'Cross block tail')).right
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 12 })
  await page.mouse.up()
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+b`)
  assert.equal(await first.textContent(), '**Cross block prose**')
  assert.equal(await last.textContent(), '**Cross block tail**')
  for (const word of ['prose', 'heading', 'quote', 'task', 'tail']) {
    await preview.locator('strong').filter({ hasText: `Cross block ${word}` }).waitFor()
  }
  assert.equal(await preview.locator('pre code').filter({ hasText: 'const keepLiteral = 1;' }).count(), 1)
  await action('保存')
  await page.getByRole('tab', { selected: true }).locator('[title="有未保存的改动"]').waitFor({ state: 'detached' })
  const inlineExpected = cases.reduce((text, item) => text.replace(` ${item.word} `, item.expected), original)
  const expected = inlineExpected.replace(/Cross block (?:prose|heading|quote|task|tail)/g, phrase => `**${phrase}**`)
  assert.equal(await readFile(file, 'utf8'), expected)
  console.log('Passed source/split context formatting with forward/reverse selections and exact Markdown.')
} finally {
  await app.close()
}

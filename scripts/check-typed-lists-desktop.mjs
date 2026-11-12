import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-typed-list-'))
const samples = {
  star: '', dash: '', plus: '', escaped: '', paragraph: 'Before marker\n',
  quote: '> Quote text\n', list: '- Existing item\n', code: '```text\ncode tail\n```\n',
  middle: 'Keep prose\n', prefix: 'Existing tail\n', ime: '',
  interior: 'Before interior\n\n# Following heading\n\nAfter heading\n',
}
const file = name => path.join(working, `${name}.md`)
const documents = Object.entries(samples).map(async ([name, text]) => {
  await writeFile(file(name), text)
  return file(name)
})
const executablePath = process.env.SUJIAN_QA_EXE
const args = [`--user-data-dir=${path.join(working, 'profile')}`]
if (!executablePath) args.push(project)

const app = await _electron.launch({ args: [...args, ...await Promise.all(documents)], ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
const live = page.getByLabel('Markdown 即时编辑')
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const tab = name => page.getByRole('tab').filter({ hasText: `${name}.md` })
page.setDefaultTimeout(10000)

async function open(name) {
  await tab(name).click()
  await live.focus()
}

async function position(selector, start = false) {
  await live.locator(selector).last().evaluate((element, start) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(start)
    document.getSelection().removeAllRanges()
    document.getSelection().addRange(range)
  }, start)
}

async function typeMarker(key = 'Shift+Digit8') {
  await page.keyboard.press(key)
  await page.keyboard.press('Space')
}

async function caret() {
  return live.evaluate(editor => {
    const selection = document.getSelection()
    const anchor = selection.anchorNode
    const element = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement
    return {
      marker: element?.closest('li')?.dataset.marker,
      offset: selection.anchorOffset,
      focused: document.activeElement === editor,
    }
  })
}

async function save(name) {
  await button('文档与视图').click()
  await button('保存', page.locator('.tool-menu-list')).click()
  await tab(name).locator('[title="有未保存的改动"]').waitFor({ state: 'detached' })
  return readFile(file(name), 'utf8')
}

try {
  await page.waitForSelector('.application[data-ready="true"]')
  for (const [name, key, marker] of [['star', 'Shift+Digit8', '*'], ['dash', 'Minus', '-'], ['plus', 'Shift+Equal', '+']]) {
    await open(name)
    await typeMarker(key)
    assert.equal(await live.locator(`ul[data-marker="${marker}"] > li`).count(), 1, name)
    assert.deepEqual(await caret(), { marker, offset: 0, focused: true })
    await page.keyboard.insertText('Written')
    assert.equal(await save(name), `${marker} Written`)
  }

  for (const [name, initialBlock, list] of [['paragraph', 'p', 'ul'], ['quote', 'blockquote p', 'blockquote ul'], ['list', 'li', 'ul > li > ul']]) {
    await open(name)
    await position(initialBlock)
    await page.keyboard.press('Enter')
    await typeMarker()
    assert.equal(await live.locator(`${list}[data-marker="*"] > li`).count(), 1, name)
    assert.deepEqual(await caret(), { marker: '*', offset: 0, focused: true })
    await page.keyboard.insertText('Written')
    assert.match(await save(name), /\* Written/)
  }

  await open('interior')
  await live.getByText('Before interior', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await typeMarker('Minus')
  assert.equal(await live.locator('ul[data-marker="-"] > li').count(), 1)
  assert.deepEqual(await caret(), { marker: '-', offset: 0, focused: true })
  await page.keyboard.insertText('Written')
  assert.match(await save('interior'), /Before interior\n\n- Written\n\n# Following heading/)

  await open('prefix')
  await position('p', true)
  await typeMarker()
  assert.deepEqual(await caret(), { marker: '*', offset: 0, focused: true })
  await page.keyboard.insertText('Before ')
  assert.equal(await save('prefix'), '* Before Existing tail\n')

  await open('escaped')
  await page.keyboard.press('Backslash')
  await typeMarker()
  await page.keyboard.insertText('Literal')
  assert.equal(await live.locator('ul').count(), 0)
  assert.equal(await save('escaped'), '\\* Literal')

  await open('middle')
  await position('p')
  await page.keyboard.press('ArrowLeft')
  await typeMarker()
  await page.keyboard.insertText('Middle')
  assert.equal(await live.locator('ul').count(), 0)
  assert.equal(await save('middle'), 'Keep pros* Middlee\n')

  await open('code')
  await live.locator('pre.vditor-ir__preview code').click()
  await position('pre.vditor-ir__marker--pre code', true)
  await typeMarker()
  assert.equal(await live.locator('ul').count(), 0)
  assert.match(await save('code'), /\* code tail/)

  await open('ime')
  await page.keyboard.press('Shift+Digit8')
  const composingPrevented = await live.evaluate(editor => {
    const input = new InputEvent('beforeinput', { inputType: 'insertText', data: ' ', isComposing: true, bubbles: true, cancelable: true })
    editor.dispatchEvent(input)
    return input.defaultPrevented
  })
  assert.equal(composingPrevented, false)
  assert.equal(await live.locator('ul').count(), 0)
  console.log('Desktop typed list markers verified immediate structure, caret, exact source, quote/list nesting, escaping, code and IME guard.')
} finally {
  await app.close()
}

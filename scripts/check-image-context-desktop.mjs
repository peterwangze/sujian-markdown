import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { waitForCheck } from './desktop-checks.mjs'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-image-context-'))
const fixture = path.join(working, '图片右键.md')
// Two true-color PNGs with contrasting upper and lower halves.
const first = {
  filename: 'first.png', width: 168, height: 114, color: [35, 90, 199],
  png: 'iVBORw0KGgoAAAANSUhEUgAAAKgAAAByCAIAAABIjA2qAAAA1ElEQVR42u3RAQ0AMAjAMLzcxLXgDy03cTHYIKHJFKxx8mlhYQF4gRd4gRd4gRd4gRd4gRd4gRd4gRd4gRd4gRd4gRd4gRd48AIv8AIv8AIv8AIv8AIv8AIv8AIv8AIv8AIv8AIv8AIv8OBdAC/wAi/wAi/wAi/wmg3/62ph4MELvMALvMALvMALvMALvMALvMALvMALvMALvMALvMALvMCDF3iBF3iBF3iBF3iBF3iBF3iBF3iBF3iBF3iBF3iBF3iBB28BeIEXeIEXeIEXeIHXbPgGMCLOSkcJ7CgAAAAASUVORK5CYII=',
}
const second = {
  filename: '图片 空格.png', width: 261, height: 159, color: [221, 83, 51],
  png: 'iVBORw0KGgoAAAANSUhEUgAAAQUAAACfCAIAAAB/fltXAAABVElEQVR42u3TQQ0AIAwEwWqpBaRgs1KwgBce90PDJKNgk627FxAlAfgB/AB+AD+AH8AP4AfwA/gB/AB+AD+AH8AP4AfwA/gB/AB+AD+AH8AP4AfwA/gB8AP4AfwAfgA/gB/AD+AH8AP4AfwAfgA/gB/AD+AH8AP4AfwAfgA/gB/AD+AH8AP4AfAD+AH8AH4AP4AfwA/gB/AD+AH8AH4AP4AfwA/gB/AD+AH8AH4AP4AfwA/gB/AD+AHIDz0HCD+AH8AP4AfwA/gB/AB+AD+AH8AP4AfwA/gB/AB+AD+AH8AP4AfwA/gB/AB+AD+AHwA/gB/AD+AH8AP4AfwAfgA/gB/AD+AH8AP4AfwAfgA/gB/AD+AH8AP4AfwAfgA/gB8AP4AfwA/gB/AD+AH8AH4AP4AfwA/gB/AD+AH8AH4AP4AfwA/gB/AD+AH8AH4AP4AfAD/A7wGZDV+QPk30jgAAAABJRU5ErkJggg==',
}
const markdown = [
  '# Image context', 'Select these ordinary words.',
  '![First picture](first.png)',
  '[![Linked picture](<图片 空格.png>)](https://example.invalid/picture)',
  '<img src="图片 空格.png" alt="Scaled picture" width="53">',
  `![Embedded picture](data:image/png;base64,${first.png})`,
  '![Broken picture](missing.png)',
].join('\n\n') + '\n'
await Promise.all([
  writeFile(fixture, markdown),
  ...[first, second].map(({ filename, png }) => writeFile(path.join(working, filename), Buffer.from(png, 'base64'))),
])

const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + path.join(working, 'profile')]
if (!executablePath) args.push(project)
args.push(fixture)
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(10000)
const live = page.getByLabel('Markdown 即时编辑')
const preview = page.locator('.editor-preview article')
const menu = page.getByRole('menu')
const tab = page.getByRole('tab', { name: path.basename(fixture), selected: true })
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const item = name => menu.getByRole('menuitem', { name, exact: true })
const copyImage = item('复制图片')

async function action(name) {
  await button('文档与视图').click()
  await button(name, page.locator('.tool-menu-list')).click()
}

async function readClipboardImage() {
  return app.evaluate(async ({ clipboard, nativeImage }) => {
    const item = (await clipboard.read()).find(entry => entry.types.includes('image/png'))
    if (!item) return null
    const png = await item.getType('image/png')
    const image = nativeImage.createFromBuffer(Buffer.from(await png.arrayBuffer()))
    const pixels = image.toBitmap()
    const color = offset => [pixels[offset + 2], pixels[offset + 1], pixels[offset]]
    return { ...image.getSize(), first: color(0), last: color(pixels.length - 4) }
  })
}

function expectedBitmap({ width, height, color }) {
  return { width, height, first: color, last: color.map(channel => 255 - channel) }
}

async function verifyImage(root, alt, expected, { linked = false, scaled = false } = {}) {
  const image = root.locator(`img[alt="${alt}"]`).filter({ visible: true })
  await image.waitFor()
  await waitForCheck(`${alt} did not load`, () => image.evaluate(element =>
    element.complete && element.naturalWidth > 0))
  await image.evaluate(element => element.decode())
  const { naturalWidth, displayWidth } = await image.evaluate(element => ({
    naturalWidth: element.naturalWidth,
    displayWidth: element.getBoundingClientRect().width,
  }))
  assert.equal(naturalWidth, expected.width)
  if (scaled) assert.ok(displayWidth < naturalWidth / 2, `${alt} must be displayed at reduced size`)
  await image.click({ button: 'right' })
  await copyImage.waitFor()
  assert.equal(await menu.getByRole('menuitem').first().textContent(), '复制图片')
  if (linked) {
    await item('打开链接').waitFor()
    await item('复制链接地址').waitFor()
  }
  await copyImage.click()
  await menu.waitFor({ state: 'hidden' })
  await delay(450)
  let actual
  try {
    await waitForCheck(`${alt} did not reach the system clipboard`, async () => {
      actual = await readClipboardImage()
      return actual && actual.width === expected.width && actual.height === expected.height
    })
  } catch (error) {
    const clipboard = await app.evaluate(async ({ clipboard }) => (await clipboard.read()).map(item => item.types))
    const notices = await page.getByRole('alert').allTextContents()
    throw new Error(`${error.message}. Got ${JSON.stringify({ actual, clipboard, notices })}`, { cause: error })
  }
  assert.deepEqual(actual, expectedBitmap(expected))
  assert.equal(await tab.locator('[title="有未保存的改动"]').count(), 0)
}

async function verifyTextContext(root) {
  const paragraph = root.getByText('Select these ordinary words.', { exact: true })
  await paragraph.scrollIntoViewIfNeeded()
  const [start, end] = await paragraph.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && !node.textContent.includes('ordinary')) node = walker.nextNode()
    if (!node) throw new Error('Selection fixture text is missing')
    const from = node.textContent.indexOf('ordinary')
    const range = document.createRange()
    return [from, from + 'ordinary'.length].map(offset => {
      range.setStart(node, offset)
      range.collapse(true)
      const rect = range.getBoundingClientRect()
      return { x: rect.x, y: rect.top + rect.height / 2 }
    })
  })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()
  const selected = await page.evaluate(() => getSelection().toString())
  assert.equal(selected, 'ordinary')
  await page.mouse.click((start.x + end.x) / 2, start.y, { button: 'right' })
  await item('复制').waitFor()
  assert.equal(await menu.getAttribute('data-selection'), 'true')
  assert.equal(await copyImage.count(), 0)
  await page.keyboard.press('Escape')
}

async function verifyNativePaste(expected) {
  await page.evaluate(() => {
    const target = document.createElement('textarea')
    target.id = 'sujian-qa-paste'
    document.body.append(target)
    target.focus({ preventScroll: true })
    globalThis.sujianQaPaste = new Promise((resolve, reject) => {
      target.addEventListener('paste', async event => {
        event.preventDefault()
        const file = [...event.clipboardData.files].find(file => file.type.startsWith('image/'))
        if (!file) return resolve(null)
        try {
          const image = await createImageBitmap(file)
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          const context = canvas.getContext('2d')
          context.drawImage(image, 0, 0)
          resolve({ width: image.width, height: image.height, color: [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)] })
          image.close()
        } catch (error) {
          reject(error)
        }
      }, { once: true })
    })
  })
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste())
    const actual = await page.evaluate(() => Promise.race([
      globalThis.sujianQaPaste,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Native paste event did not arrive')), 4000)),
    ]))
    const notices = await page.getByRole('alert').allTextContents()
    assert.deepEqual(actual, { width: expected.width, height: expected.height, color: expected.color }, notices.join(', '))
  } finally {
    await page.evaluate(() => document.getElementById('sujian-qa-paste').remove())
  }
}

try {
  await page.waitForSelector('.application[data-ready="true"]')
  await tab.waitFor()
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    const entries = (await clipboard.read()).filter(entry => entry.types.length)
    globalThis.sujianQaOriginalClipboard = await Promise.all(entries.map(async entry => {
      const data = await Promise.all(entry.types.map(async type => [type, await entry.getType(type)]))
      return new ClipboardItem(Object.fromEntries(data))
    }))
  })
  try {
    await verifyImage(live, 'First picture', first)
    await verifyImage(live, 'Linked picture', second, { linked: true })
    await verifyTextContext(live)
    console.log('Instant mode copies the clicked bitmap and preserves the text and link menus.')

    await action('分栏预览')
    await verifyImage(preview, 'First picture', first)
    await verifyImage(preview, 'Linked picture', second, { linked: true })
    console.log('Split preview copies both images independently.')

    await action('阅读模式')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
    await verifyImage(preview, 'First picture', first)
    await verifyImage(preview, 'Scaled picture', second, { scaled: true })
    await verifyNativePaste(second)
    await verifyImage(preview, 'Embedded picture', first)
    const broken = preview.locator('img[alt="Broken picture"]')
    await broken.waitFor()
    await waitForCheck('Broken picture is not loaded', () =>
      broken.evaluate(image => image.complete && !image.naturalWidth))
    await broken.click({ button: 'right' })
    await menu.waitFor()
    assert.equal(await copyImage.count(), 0)
    await page.keyboard.press('Escape')
    console.log('Reading mode at 125% copies original pixels and embedded images, pastes an image file, and leaves broken images unavailable.')

    await action('保存')
    assert.equal(await readFile(fixture, 'utf8'), markdown)
  } finally {
    const lastImage = await readClipboardImage()
    if ([first, second].some(image => JSON.stringify(lastImage) === JSON.stringify(expectedBitmap(image)))) {
      await app.evaluate(async ({ clipboard }) => {
        const original = globalThis.sujianQaOriginalClipboard
        if (original.length) await clipboard.write(original)
        else clipboard.clear()
      })
    }
  }
} finally {
  await app.close()
}

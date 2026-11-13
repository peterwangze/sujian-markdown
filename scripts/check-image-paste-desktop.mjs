import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { _electron } from 'playwright'
import { waitForCheck } from './desktop-checks.mjs'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-image-paste-'))
const pictures = path.join(working, '原图')
const notes = path.join(working, '笔记')
const nativeImage = path.join(pictures, '本地 图 100%.png')
const textImage = path.join(pictures, '路径 图.png')
const htmlImage = path.join(pictures, 'HTML 图.png')
const initial = 'Paste anchor.\n'
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n5sAAAAASUVORK5CYII='
const bytes = Buffer.from(png, 'base64')
const documents = Object.fromEntries([
  '原文件', '路径加像素', '路径文本', '无效路径文本', '图像地址', '网络图片', '拖入图片', '工具栏选图', '纯像素', '无效路径加像素', '普通粘贴', '只读预览', '源码代码块',
].map(name => [name, path.join(notes, name + '.md')]))
const codeBlock = '```text\nPaste anchor.\n```\n'

await Promise.all([mkdir(pictures), mkdir(notes)])
await Promise.all([
  ...[nativeImage, textImage, htmlImage].map(file => writeFile(file, bytes)),
  ...Object.entries(documents).map(([name, file]) => writeFile(file, name === '源码代码块' ? codeBlock : initial)),
])

const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + path.join(working, 'profile'), ...(executablePath ? [] : [project]), ...Object.values(documents)]
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(10000)
const live = page.getByLabel('Markdown 即时编辑')
const source = page.getByLabel('Markdown 源码')
const preview = page.locator('.editor-preview article')
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const tab = name => page.getByRole('tab').filter({ has: page.getByText(name + '.md', { exact: true }) })
const dirty = name => tab(name).locator('[title="有未保存的改动"]')
const assets = name => path.join(path.dirname(documents[name]), name + '.assets')

async function action(name) {
  await button('文档与视图').click()
  await button(name, page.locator('.tool-menu-list')).click()
}

async function open(name, mode = '即时') {
  await tab(name).click()
  if (mode === '分栏预览' || mode === '阅读模式') await action(mode)
  else if (mode === '源码') await button(mode).click()
  const editor = mode === '即时' ? live : mode === '阅读模式' ? preview : source
  await editor.waitFor()
  if (mode !== '阅读模式') {
    const paragraph = editor.getByText('Paste anchor.', { exact: true })
    await paragraph.click()
    await page.keyboard.press('End')
  }
  return editor
}

async function transferImage(editor, { file, bitmap = false, text, html, uris, kind = 'paste', handled = true } = {}) {
  const id = 'sujian-paste-path-fixture'
  if (file) {
    await page.evaluate(id => {
      const input = document.createElement('input')
      input.type = 'file'
      input.id = id
      input.hidden = true
      document.body.append(input)
    }, id)
    await page.locator('#' + id).setInputFiles(file)
  }
  const payload = await editor.evaluate((element, { id, bitmap, base64, text, html, uris, kind }) => {
    const input = document.getElementById(id)
    const transfer = new DataTransfer()
    if (input) transfer.items.add(input.files[0])
    else if (bitmap) {
      const pixels = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
      transfer.items.add(new File([pixels], 'clipboard.png', { type: 'image/png' }))
    }
    if (text !== undefined) transfer.setData('text/plain', text)
    if (html !== undefined) transfer.setData('text/html', html)
    if (uris !== undefined) transfer.setData('text/uri-list', uris)
    const nativePath = transfer.files[0] ? window.sujian.filePath(transfer.files[0]) : ''
    if (transfer.files[0]) window.sujianQaTransferFiles.add(transfer.files[0].name)
    element.focus()
    const event = kind === 'drop'
      ? new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
      : new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
    const accepted = !element.dispatchEvent(event)
    input?.remove()
    return { nativePath, accepted }
  }, { id, bitmap, base64: png, text, html, uris, kind })
  assert.equal(payload.nativePath, file ?? '', 'The transfer must preserve the expected native File path')
  assert.equal(payload.accepted, handled, `Unexpected default handling for ${kind}`)
}

async function save(name) {
  await dirty(name).waitFor()
  await action('保存')
  await dirty(name).waitFor({ state: 'hidden' })
  const markdown = await readFile(documents[name], 'utf8')
  assert.ok(markdown.includes('Paste anchor.'), 'Paste should keep unrelated document text')
  return markdown
}

function destination(markdown) {
  const references = [...markdown.matchAll(/!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))\)/g)]
  assert.equal(references.length, 1, `Expected one Markdown image reference: ${markdown}`)
  return references[0][1] ?? references[0][2]
}

async function resolveReference(name, markdown) {
  const reference = destination(markdown)
  const file = reference.startsWith('file:') ? fileURLToPath(reference) : path.resolve(path.dirname(documents[name]), decodeURIComponent(reference))
  return realpath(file)
}

async function verifyReference(name, file) {
  const markdown = await save(name)
  assert.match(destination(markdown), /^\.\.\//, 'Existing images in sibling folders should use portable relative paths')
  assert.equal(await resolveReference(name, markdown), await realpath(file))
  await assert.rejects(access(assets(name)), { code: 'ENOENT' })
  await assert.rejects(access(path.join(working, 'profile', 'assets')), { code: 'ENOENT' })
  assert.deepEqual(await readFile(file), bytes)
}

async function assertNoPixelReads() {
  const reads = await page.evaluate(() => window.sujianQaPixelReads.splice(0))
  assert.deepEqual(reads, [], 'Pasting a usable image path should not read clipboard bitmap bytes')
}

async function verifyBitmap(name) {
  const markdown = await save(name)
  const copied = await readdir(assets(name))
  assert.equal(copied.length, 1)
  assert.equal(await resolveReference(name, markdown), await realpath(path.join(assets(name), copied[0])))
  assert.deepEqual(await readFile(path.join(assets(name), copied[0])), bytes)
}

try {
  await page.waitForSelector('.application[data-ready="true"]')
  await page.evaluate(() => {
    window.sujianQaTransferFiles = new Set()
    window.sujianQaPixelReads = []
    const arrayBuffer = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = function () {
      if (window.sujianQaTransferFiles.has(this.name)) window.sujianQaPixelReads.push(this.name)
      return arrayBuffer.call(this)
    }
  })

  await transferImage(await open('原文件'), { file: nativeImage })
  await waitForCheck('The instant editor must render the original image', () => live.locator('img').evaluate(image => image.complete && image.naturalWidth > 0))
  await verifyReference('原文件', nativeImage)
  await assertNoPixelReads()
  await button('关闭 原文件.md').click()
  await tab('原文件').waitFor({ state: 'hidden' })
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, documents['原文件'])
  await action('打开文件')
  await tab('原文件').waitFor()
  await waitForCheck('The original image must still load after reopening', () => live.locator('img').evaluate(image => image.complete && image.naturalWidth > 0))
  console.log('Instant editing pastes a native-path File without copying it.')

  await transferImage(await open('路径加像素', '源码'), { bitmap: true, text: `"${textImage}"` })
  await verifyReference('路径加像素', textImage)
  await assertNoPixelReads()
  console.log('Source editing prefers a quoted local image path over the accompanying bitmap.')

  await transferImage(await open('路径文本', '源码'), { text: pathToFileURL(textImage).href })
  await verifyReference('路径文本', textImage)
  const missing = path.join(working, '不存在.png')
  await transferImage(await open('无效路径文本', '源码'), { text: missing })
  assert.equal(await save('无效路径文本'), `Paste anchor.${missing}\n`)
  await assert.rejects(access(assets('无效路径文本')), { code: 'ENOENT' })

  const url = pathToFileURL(htmlImage).href
  await transferImage(await open('图像地址', '分栏预览'), { bitmap: true, html: `<img src="${url}" alt="Local image">`, uris: url })
  await waitForCheck('Split preview must render the referenced image', () => preview.locator('img').evaluate(image => image.complete && image.naturalWidth > 0))
  await verifyReference('图像地址', htmlImage)
  await assertNoPixelReads()
  console.log('Split preview renders an image referenced through clipboard HTML and URI data.')

  const remote = 'https://example.invalid/image.png'
  await transferImage(await open('网络图片', '源码'), { bitmap: true, html: `<img src="${remote}" alt="Remote image">` })
  assert.equal(destination(await save('网络图片')), remote)
  await assert.rejects(access(assets('网络图片')), { code: 'ENOENT' })
  await assertNoPixelReads()
  console.log('An image URL from clipboard HTML is referenced without creating a local copy.')

  await transferImage(await open('拖入图片'), { file: nativeImage, kind: 'drop' })
  await verifyReference('拖入图片', nativeImage)
  await open('工具栏选图')
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, textImage)
  await button('更多编辑工具').click()
  await button('插入本地图片', page.locator('.tool-menu-list')).click()
  await verifyReference('工具栏选图', textImage)
  console.log('Dropping a file or choosing it from the toolbar uses the same original file reference.')

  const draft = path.join(notes, '引用草稿.md')
  await button('新建文档').click()
  await live.waitFor()
  await transferImage(live, { file: nativeImage })
  await waitForCheck('A new unsaved document must render the original image', () => live.locator('img').evaluate(image => image.complete && image.naturalWidth > 0))
  await assert.rejects(access(path.join(working, 'profile', 'assets')), { code: 'ENOENT' })
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, draft)
  await action('保存')
  await tab('引用草稿').waitFor()
  const draftReference = destination(await readFile(draft, 'utf8'))
  const draftImage = draftReference.startsWith('file:') ? fileURLToPath(draftReference) : path.resolve(notes, decodeURIComponent(draftReference))
  assert.equal(await realpath(draftImage), await realpath(nativeImage))
  await assert.rejects(access(path.join(notes, '引用草稿.assets')), { code: 'ENOENT' })
  await waitForCheck('A saved draft must keep rendering the original image', () => live.locator('img').evaluate(image => image.complete && image.naturalWidth > 0))
  console.log('A new draft references the original image before and after saving.')

  await transferImage(await open('纯像素'), { bitmap: true })
  await verifyBitmap('纯像素')
  await transferImage(await open('无效路径加像素', '源码'), { bitmap: true, text: missing })
  await verifyBitmap('无效路径加像素')
  const reads = await page.evaluate(() => window.sujianQaPixelReads.splice(0))
  assert.deepEqual(reads, ['clipboard.png', 'clipboard.png'])
  console.log('Pixel-only clipboard data and an unusable path both save one image asset on demand.')

  const plain = 'ordinary clipboard text'
  await transferImage(await open('普通粘贴', '源码'), { text: plain })
  const markdown = await save('普通粘贴')
  assert.equal(markdown, `Paste anchor.${plain}\n`)
  await assert.rejects(access(assets('普通粘贴')), { code: 'ENOENT' })
  await transferImage(await open('源码代码块', '源码'), { text: textImage })
  assert.equal(await save('源码代码块'), codeBlock.replace('Paste anchor.', 'Paste anchor.' + textImage))
  await assert.rejects(access(assets('源码代码块')), { code: 'ENOENT' })
  await open('只读预览', '分栏预览')
  await transferImage(preview, { bitmap: true, handled: false })
  await action('阅读模式')
  await preview.waitFor()
  await transferImage(preview, { bitmap: true, handled: false })
  assert.equal(await dirty('只读预览').count(), 0)
  await assert.rejects(access(assets('只读预览')), { code: 'ENOENT' })
  assert.deepEqual(await page.locator('.toast.error').allTextContents(), [])
  console.log('Ordinary and code text remain plain text, and read-only panes do not import clipboard data.')
} finally {
  await app.close()
}

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { _electron } from 'playwright'
import { waitForCheck } from './desktop-checks.mjs'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-image-files-'))
const output = path.join(working, '另存图片')
const profile = path.join(working, 'profile')
const root = path.join(working, '图片根目录')
const fixture = path.join(working, '图片操作.md')
const relative = path.join(working, '带链接的 图.svg')
const rootRelative = path.join(root, '从根读取的 图.svg')
const fileUrl = path.join(working, '绝对路径 图.svg')
const svg = color => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="78"><rect width="144" height="78" fill="${color}"/></svg>\n`)
const images = [
  { alt: 'Linked local image', filename: relative, bytes: svg('royalblue'), source: `[![Linked local image](<${path.basename(relative)}>)](https://example.invalid/link)` },
  { alt: 'Root local image', filename: rootRelative, bytes: svg('seagreen'), source: `![Root local image](</${path.basename(rootRelative)}>)` },
  { alt: 'Absolute local image', filename: fileUrl, bytes: svg('tomato'), source: `<img src="${pathToFileURL(fileUrl).href}" alt="Absolute local image" width="42">` },
]
const png = 'iVBORw0KGgoAAAANSUhEUgAAAKgAAAByCAIAAABIjA2qAAAA1ElEQVR42u3RAQ0AMAjAMLzcxLXgDy03cTHYIKHJFKxx8mlhYQF4gRd4gRd4gRd4gRd4gRd4gRd4gRd4gRd4gRd4gRd48AIv8AIv8AIv8AIv8AIv8AIv8AIv8AIv8AIv8AIv8AIv8OBdAC/wAi/wAi/wAi/wmg3/62ph4MELvMALvMALvMALvMALvMALvMALvMALvMALvMALvMALvMCDF3iBF3iBF3iBF3iBF3iBF3iBF3iBF3iBF3iBF3iBF3iBB28BeIEXeIEXeIEXeIHXbPgGMCLOSkcJ7CgAAAAASUVORK5CYII='
const embedded = { alt: 'Embedded image', bytes: Buffer.from(png, 'base64') }
const remote = { alt: 'Remote image', url: 'https://example.invalid/remote.svg', bytes: svg('orchid') }
const markdown = [
  '# 图片文件操作',
  ...images.map(image => image.source),
  `![${embedded.alt}](data:image/png;base64,${png})`,
  `![${remote.alt}](${remote.url})`,
  '![Missing image](missing.png)',
].join('\n\n') + '\n'
await Promise.all([output, profile, root].map(directory => mkdir(directory)))
await Promise.all([
  ...images.map(image => writeFile(image.filename, image.bytes)),
  writeFile(fixture, markdown),
  writeFile(path.join(profile, 'preferences.json'), JSON.stringify({ imageRoot: root, remoteMedia: true })),
])

const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + profile, ...(executablePath ? [] : [project])]
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(10000)
const live = page.getByLabel('Markdown 即时编辑')
const preview = page.locator('.editor-preview article')
const menu = page.getByRole('menu')
const tab = page.getByRole('tab', { name: path.basename(fixture), selected: true })
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const item = name => menu.getByRole('menuitem', { name, exact: true })
const saveAs = item('图片另存为…')
const reveal = item('在文件夹中显示')

async function action(name) {
  await button('文档与视图').click()
  await button(name, page.locator('.tool-menu-list')).click()
}

async function inspectNative() {
  return app.evaluate(() => globalThis.sujianImageFilesQa)
}

async function selectDestination(filePath, canceled = false) {
  await app.evaluate((_, response) => {
    globalThis.sujianImageFilesQa.saveResponse = response
  }, { filePath, canceled })
}

async function imageMenu(root, { alt }, loaded = true) {
  const image = root.locator(`img[alt="${alt}"]`).filter({ visible: true })
  await image.waitFor()
  await waitForCheck(`${alt} load state is incorrect`, () => image.evaluate((element, loaded) =>
    element.complete && (element.naturalWidth > 0) === loaded, loaded))
  await image.click({ button: 'right' })
  await menu.waitFor()
}

async function verifySave(root, image, destination, defaultName, filePath = destination) {
  const before = await inspectNative()
  await selectDestination(filePath)
  await imageMenu(root, image)
  await saveAs.click()
  await page.getByRole('status').getByText('图片已保存 · ' + path.basename(destination), { exact: true }).waitFor()
  assert.deepEqual(await readFile(destination), image.bytes)
  const { dialogs } = await inspectNative()
  assert.equal(dialogs.length, before.dialogs.length + 1)
  const requested = dialogs.at(-1)
  assert.equal(path.basename(requested.defaultPath), defaultName)
  assert.deepEqual(requested.extensions, [path.extname(defaultName).slice(1)])
  await menu.waitFor({ state: 'hidden' })
}

async function verifyLocal(root, image, destination, filePath = destination) {
  const before = await inspectNative()
  await imageMenu(root, image)
  const commands = await menu.getByRole('menuitem').allTextContents()
  assert.deepEqual(commands.slice(0, 3), ['复制图片', '图片另存为…', '在文件夹中显示'])
  if (image.alt === 'Linked local image') {
    await item('打开链接').waitFor()
    await item('复制链接地址').waitFor()
  }
  await reveal.click()
  await waitForCheck(`File manager was not called for ${image.alt}`, async () =>
    (await inspectNative()).reveals.length > before.reveals.length)
  const { reveals, dialogs } = await inspectNative()
  assert.equal(reveals.length, before.reveals.length + 1)
  assert.equal(reveals.at(-1), await realpath(image.filename))
  assert.deepEqual(dialogs, before.dialogs)
  await verifySave(root, image, destination, path.basename(image.filename), filePath)
  assert.deepEqual(await readFile(image.filename), image.bytes)
}

try {
  await app.evaluate(({ dialog, shell, protocol }, { fixture, url, svg }) => {
    globalThis.sujianImageFilesQa = { dialogs: [], reveals: [], saveResponse: { canceled: true }, requests: [] }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] })
    dialog.showSaveDialog = async (_window, { defaultPath, filters }) => {
      globalThis.sujianImageFilesQa.dialogs.push({ defaultPath, extensions: filters?.[0]?.extensions })
      return globalThis.sujianImageFilesQa.saveResponse
    }
    shell.showItemInFolder = filename => globalThis.sujianImageFilesQa.reveals.push(filename)
    protocol.handle('https', request => {
      globalThis.sujianImageFilesQa.requests.push(request.url)
      return request.url === url
        ? new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } })
        : new Response(null, { status: 404 })
    })
  }, { fixture, url: remote.url, svg: remote.bytes.toString() })
  await page.waitForSelector('.application[data-ready="true"]')
  await action('打开文件')
  await tab.waitFor()

  await verifyLocal(live, images[0], path.join(output, '即时.svg'))
  console.log('Instant editing reveals the clicked link image and saves the original SVG.')

  await action('分栏预览')
  await verifyLocal(preview, images[1], path.join(output, '分栏.svg'), path.join(output, '分栏'))
  const existing = path.join(output, '分栏.svg')
  await selectDestination(path.join(output, '分栏'))
  await imageMenu(preview, images[0])
  await saveAs.click()
  await page.getByRole('alert').filter({ hasText: '同名图片已存在' }).waitFor()
  assert.deepEqual(await readFile(existing), images[1].bytes)
  await page.getByRole('alert').filter({ hasText: '同名图片已存在' }).waitFor({ state: 'hidden' })
  console.log('Split preview resolves the configured image root and appends the original extension.')

  await action('阅读模式')
  await verifyLocal(preview, images[2], path.join(output, '阅读.svg'))
  await imageMenu(preview, embedded)
  await saveAs.waitFor()
  assert.equal(await reveal.count(), 0)
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  assert.deepEqual(await page.locator('.toast.error').allTextContents(), [], 'Escape from the embedded image menu failed')
  await verifySave(preview, embedded, path.join(output, '内嵌.png'), 'Embedded image.png')

  await imageMenu(preview, remote)
  await saveAs.waitFor()
  assert.equal(await reveal.count(), 0)
  await page.keyboard.press('Escape')
  await verifySave(preview, remote, path.join(output, '网络.svg'), 'remote.svg')
  assert.ok((await inspectNative()).requests.filter(url => url === remote.url).length >= 2)

  const beforeCancel = await inspectNative()
  const canceled = path.join(output, '已取消.svg')
  await selectDestination(canceled, true)
  await imageMenu(preview, images[0])
  await saveAs.click()
  await waitForCheck('Canceled Save As did not reach the dialog', async () =>
    (await inspectNative()).dialogs.length > beforeCancel.dialogs.length)
  await menu.waitFor({ state: 'hidden' })

  const beforeSameFile = await inspectNative()
  const beforeSameFileWrite = await readFile(images[0].filename)
  await selectDestination(images[0].filename)
  await imageMenu(preview, images[0])
  await saveAs.click()
  await waitForCheck('Same-file Save As did not reach the dialog', async () =>
    (await inspectNative()).dialogs.length > beforeSameFile.dialogs.length)
  await menu.waitFor({ state: 'hidden' })

  await imageMenu(preview, { alt: 'Missing image' }, false)
  assert.equal(await saveAs.count(), 0)
  assert.equal(await reveal.count(), 0)
  await page.keyboard.press('Escape')

  const requestsBeforeDisabling = (await inspectNative()).requests.length
  await button('设置').click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await button('文件与资源', settings).click()
  await settings.getByLabel('显示网络图片').uncheck()
  await button('关闭', settings).click()
  const blocked = preview.locator(`img[alt="${remote.alt}"]`)
  await waitForCheck('Remote image remained available after disabling network images', () =>
    blocked.evaluate(image => !image.getAttribute('src') && !image.naturalWidth))
  if (await blocked.isVisible()) {
    await imageMenu(preview, remote, false)
    assert.equal(await saveAs.count(), 0)
    assert.equal(await reveal.count(), 0)
    await page.keyboard.press('Escape')
  }
  assert.equal((await inspectNative()).requests.length, requestsBeforeDisabling)

  await preview.getByRole('heading', { name: '图片文件操作' }).click({ button: 'right' })
  await menu.waitFor()
  assert.equal(await saveAs.count(), 0)
  assert.equal(await reveal.count(), 0)
  await page.keyboard.press('Escape')
  console.log('Reading verifies a scaled file URL, embedded and network files, cancellation, missing files and network opt-out.')

  await assert.rejects(readFile(canceled), { code: 'ENOENT' })
  assert.deepEqual(await readFile(images[0].filename), beforeSameFileWrite)
  assert.deepEqual(await page.locator('.toast.error').allTextContents(), [])
  await action('保存')
  assert.deepEqual(await readFile(fixture), Buffer.from(markdown))
  assert.equal(await tab.locator('[title="有未保存的改动"]').count(), 0)
} finally {
  await app.close()
}

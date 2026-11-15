import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { _electron } from 'playwright'
import { waitForCheck } from './desktop-checks.mjs'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-batch-images-'))
const profile = path.join(working, 'profile')
const notes = path.join(working, '项目笔记')
const originals = path.join(working, '原素材')
const other = path.join(working, '另一组素材')
const targetName = '批量收拢.md'
const backgroundName = '只含失效图片.md'
const cancelName = '取消收拢.md'
const activeName = '当前文档.md'
const targetFile = path.join(notes, targetName)
const backgroundFile = path.join(notes, backgroundName)
const cancelFile = path.join(notes, cancelName)
const activeFile = path.join(notes, activeName)
const managedName = '批量收拢.assets'
const managed = path.join(notes, managedName)
const relocation = path.join(working, '已交付副本', '重新打开')
const filename = '插图 100% 中文.svg'
const localFile = path.join(originals, filename)
const otherFile = path.join(other, filename)
const relative = '../原素材/' + encodeURIComponent(filename)
const absolute = localFile.replaceAll('\\', '/').replaceAll('%', '%25')
const fileUrl = pathToFileURL(localFile).href
const remote = 'https://example.invalid/diagram.svg?version=3'
const heldRemote = 'https://example.invalid/hold.svg'
const missing = '../原素材/找不到.svg'
const missingRef = `![失效图片](<${missing}>)`
const untouchedLink = '[共享来源][shared]'
const untouchedDefinition = `[shared]: <${relative}> "共享标题"`
const code = `\`\`\`md\r\n![代码里的图片](<${relative}>)\r\n\`\`\``
const docs = [
  '# 便携交付', '',
  `![相对路径](<${relative}> "本地标题")`, '',
  `![绝对路径](<${absolute}>)`, '',
  `![文件地址](<${fileUrl}>)`, '',
  '![共享图片][shared]', '',
  `<div><img width="56" alt="HTML 图片" src="${relative}"></div>`, '',
  `![同名不同原图](<../另一组素材/${encodeURIComponent(filename)}>)`, '',
  `![网络图一](${remote})`, '',
  `![网络图二](${remote})`, '',
  `![已收拢](<${encodeURIComponent(managedName)}/existing.svg>)`, '',
  missingRef, '', untouchedLink, '', untouchedDefinition, '', code, '',
].join('\r\n')
const activeSource = `# 当前文档\r\n\r\n![其他文档图片](<${relative}>)\r\n`
const backgroundSource = `# 失效图\r\n\r\n${missingRef}\r\n`
const cancelSource = `# 取消\r\n\r\n![本地](<${relative}>)\r\n\r\n![延迟加载](${heldRemote})\r\n`
const svg = (width, color) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="31"><rect width="${width}" height="31" fill="${color}"/></svg>\n`)
const localBytes = svg(73, 'green')
const otherBytes = svg(79, 'blue')
const remoteBytes = svg(83, 'red')
const existingBytes = svg(89, 'purple')
const expectedWidths = new Map([
  ['相对路径', 73], ['绝对路径', 73], ['文件地址', 73], ['共享图片', 73], ['HTML 图片', 73],
  ['同名不同原图', 79], ['网络图一', 83], ['网络图二', 83], ['已收拢', 89],
])
await Promise.all([profile, managed, originals, other, relocation].map(directory => mkdir(directory, { recursive: true })))
await Promise.all([
  writeFile(targetFile, docs), writeFile(backgroundFile, backgroundSource), writeFile(cancelFile, cancelSource), writeFile(activeFile, activeSource),
  writeFile(localFile, localBytes), writeFile(otherFile, otherBytes), writeFile(path.join(managed, 'existing.svg'), existingBytes),
  writeFile(path.join(profile, 'preferences.json'), JSON.stringify({ workspace: notes, sidebar: true, remoteMedia: true, autoSave: false, resume: false })),
])

const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + profile, ...(executablePath ? [] : [project])]
let app
let page
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const tab = name => page.locator('[role="tab"]').filter({ has: page.getByText(name, { exact: true }) })
const dirty = name => tab(name).locator('[title="有未保存的改动"]')
const sidebar = () => page.getByRole('complementary', { name: '文件与大纲' })
const row = name => button(name, sidebar()).and(sidebar().locator('[data-level]'))

async function launch(openFile, serveRemote) {
  app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
  page = await app.firstWindow()
  page.setDefaultTimeout(12000)
  await app.evaluate(({ dialog, protocol }, { file, url, held, data }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    globalThis.sujianBatchRemoteRequests = []
    protocol.handle('https', request => {
      globalThis.sujianBatchRemoteRequests.push(request.url)
      const image = () => new Response(data, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } })
      if (!data) return new Response(null, { status: 404 })
      if (request.url === url) return image()
      if (request.url === held) return new Promise(resolve => { globalThis.sujianReleaseHeldImage = () => resolve(image()) })
      return new Response(null, { status: 404 })
    })
  }, { file: openFile, url: remote, held: heldRemote, data: serveRemote ? remoteBytes.toString() : '' })
  await page.waitForSelector('.application[data-ready="true"]')
  await action('打开文件')
  await tab(path.basename(openFile)).waitFor()
}

async function action(name) {
  await button('文档与视图').click()
  await button(name, page.locator('.tool-menu-list')).click()
}

async function startCollection(entry, name, { keyboard = false } = {}) {
  if (keyboard) await entry.press('Shift+F10')
  else await entry.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: '操作 ' + name })
  const item = menu.getByRole('menuitem', { name: '收拢图片到文档资源目录', exact: true })
  if (keyboard) await item.press('Enter')
  else await item.click()
}

async function collect(entry, name, options) {
  await startCollection(entry, name, options)
  const result = page.getByRole('dialog', { name: '图片收拢结果', exact: true })
  await result.waitFor()
  return result
}

async function closeResult(result) {
  await button('完成', result).click()
  await result.waitFor({ state: 'hidden' })
}

async function assertMissingShown(result) {
  await result.getByText(missing, { exact: false }).first().waitFor()
  const summary = await result.textContent()
  assert.match(summary, /找不到|不存在|失效|失败|未能/u)
}

async function assertAssets(folder) {
  const names = await readdir(folder)
  assert.equal(names.length, 4, `Expected three unique copies and one pre-existing asset: ${names}`)
  assert.deepEqual(await readFile(path.join(folder, 'existing.svg')), existingBytes)
  const copies = await Promise.all(names.filter(name => name !== 'existing.svg').map(name => readFile(path.join(folder, name))))
  for (const content of [localBytes, otherBytes, remoteBytes]) {
    assert.equal(copies.filter(copy => copy.equals(content)).length, 1)
  }
  return names.sort()
}

async function assertDecoded(root) {
  const images = root.locator('img')
  await waitForCheck('Relocated images must decode successfully', async () => {
    if (await images.count() < expectedWidths.size) return false
    const dimensions = new Map(await images.evaluateAll(elements => elements.map(image => [image.alt, image.naturalWidth])))
    return [...expectedWidths].every(([alt, width]) => dimensions.get(alt) === width)
  })
  const resolved = new Map(await images.evaluateAll(elements => elements.map(image => [image.alt, image.currentSrc])))
  const localReferences = ['相对路径', '绝对路径', '文件地址', '共享图片', 'HTML 图片']
  assert.equal(new Set(localReferences.map(alt => resolved.get(alt))).size, 1, 'All aliases must use the same copied image')
  assert.equal(resolved.get('网络图一'), resolved.get('网络图二'))
  assert.notEqual(resolved.get('同名不同原图'), resolved.get('相对路径'))
  for (const alt of expectedWidths.keys()) {
    const source = resolved.get(alt)
    assert.match(source, /^sujian-asset:\/\/local\//)
    const token = new URL(source).pathname.slice(1)
    const [documentPath, reference] = JSON.parse(Buffer.from(token, 'base64url').toString())
    assert.equal(path.normalize(documentPath), path.join(relocation, targetName))
    assert.ok(decodeURIComponent(reference).startsWith(managedName + '/'), reference)
  }
}

try {
  await launch(activeFile, true)
  await row(targetName).waitFor()
  assert.equal(await tab(targetName).count(), 0, 'The target should start unopened')

  const firstResult = await collect(row(targetName), targetName)
  assert.equal(await tab(activeName).getAttribute('aria-selected'), 'true')
  await tab(targetName).waitFor()
  await assertMissingShown(firstResult)
  assert.match(await firstResult.textContent(), /3\s*张图片[，,、\s]+更新\s*8\s*处引用/u)
  if (process.env.SUJIAN_BATCH_SCREENSHOT) {
    await firstResult.screenshot({ path: process.env.SUJIAN_BATCH_SCREENSHOT, scale: 'css' })
  }
  await dirty(targetName).waitFor()
  assert.equal(await readFile(targetFile, 'utf8'), docs, 'Batch collection should follow normal document saving')
  assert.equal(await readFile(activeFile, 'utf8'), activeSource)
  await assert.rejects(access(path.join(notes, '当前文档.assets')), { code: 'ENOENT' })
  assert.deepEqual(await readFile(localFile), localBytes)
  assert.deepEqual(await readFile(otherFile), otherBytes)
  const copies = await assertAssets(managed)
  console.log('Sidebar batch targeted the unopened document, reported its broken image and copied each original once.')

  await button('保存文档', firstResult).click()
  await dirty(targetName).waitFor({ state: 'hidden' })
  if (await firstResult.isVisible()) await closeResult(firstResult)
  assert.equal(await tab(activeName).getAttribute('aria-selected'), 'true')
  const saved = await readFile(targetFile, 'utf8')
  for (const untouched of [missingRef, untouchedLink, untouchedDefinition, code, '"本地标题"', '"共享标题"']) {
    assert.ok(saved.includes(untouched), `Expected to preserve ${untouched}`)
  }
  assert.doesNotMatch(saved, /(?<!\r)\n/, 'Source CRLF must survive the rewrites')

  await tab(targetName).click()
  const secondResult = await collect(tab(targetName), targetName, { keyboard: true })
  await assertMissingShown(secondResult)
  await closeResult(secondResult)
  assert.deepEqual(await assertAssets(managed), copies)
  assert.equal(await dirty(targetName).count(), 0)
  assert.equal(await readFile(targetFile, 'utf8'), saved)

  const failedResult = await collect(row(backgroundName), backgroundName)
  await assertMissingShown(failedResult)
  assert.equal(await tab(targetName).getAttribute('aria-selected'), 'true')
  await closeResult(failedResult)
  assert.equal(await dirty(backgroundName).count(), 0)
  assert.equal(await readFile(backgroundFile, 'utf8'), backgroundSource)
  await assert.rejects(access(path.join(notes, '只含失效图片.assets')), { code: 'ENOENT' })
  console.log('Keyboard batch rerun is idempotent. A failed-only document remains unchanged and creates no asset directory.')

  const cancelFolder = path.join(notes, '取消收拢.assets')
  const cancelContents = () => readdir(cancelFolder).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  await startCollection(row(cancelName), cancelName)
  const progress = page.getByRole('dialog', { name: '正在收拢图片', exact: true })
  await progress.waitFor()
  await waitForCheck('The unfinished batch must reach the held network response', () =>
    app.evaluate(() => typeof globalThis.sujianReleaseHeldImage === 'function'))
  await waitForCheck('A local copy must already exist when the operation is canceled', async () => (await cancelContents()).length === 1)
  await button('取消', progress).click()
  await progress.waitFor({ state: 'hidden' })
  await app.evaluate(() => globalThis.sujianReleaseHeldImage())
  await waitForCheck('Canceled operation must clean up all newly copied files', async () => (await cancelContents()).length === 0)
  assert.equal(await page.getByRole('dialog', { name: '图片收拢结果', exact: true }).count(), 0)
  assert.equal(await dirty(cancelName).count(), 0)
  assert.equal(await readFile(cancelFile, 'utf8'), cancelSource)
  console.log('Canceling while a network image is loading rolls back the already copied local image and preserves the document.')

  await app.close()
  app = null
  const movedFile = path.join(relocation, targetName)
  await rename(targetFile, movedFile)
  await rename(managed, path.join(relocation, managedName))
  await rename(originals, path.join(working, '暂存原素材'))
  await rename(other, path.join(working, '暂存另一组素材'))
  await assert.rejects(access(localFile), { code: 'ENOENT' })
  await assert.rejects(access(otherFile), { code: 'ENOENT' })
  await assert.rejects(access(targetFile), { code: 'ENOENT' })
  await assert.rejects(access(managed), { code: 'ENOENT' })
  await assertAssets(path.join(relocation, managedName))

  await launch(movedFile, false)
  await assertDecoded(page.getByLabel('Markdown 即时编辑'))
  await action('分栏预览')
  await assertDecoded(page.locator('.editor-preview article'))
  await action('阅读模式')
  await assertDecoded(page.locator('.editor-preview article'))
  assert.deepEqual(await app.evaluate(() => globalThis.sujianBatchRemoteRequests), [])
  console.log('Relocated Markdown and assets reopen with all nine valid images decoded in instant, split and reading modes, with originals and network unavailable.')
} finally {
  await app?.close()
}

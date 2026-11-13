import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { waitForCheck } from './desktop-checks.mjs'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-image-collection-'))
const profile = path.join(working, 'profile')
const note = path.join(working, '笔记.md')
const imageFile = path.join(working, '外部 图.svg')
const managed = path.join(working, '附件目录')
const remote = 'https://example.invalid/remote.svg?version=2'
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="70" height="30"><rect width="70" height="30" fill="green"/></svg>\n')
const remoteSvg = Buffer.from(svg.toString().replace('green', 'red'))
const source = [
  '# 原图与副本',
  '> - [![第一张](<外部 图.svg> "原图标题")](https://example.invalid/link)',
  '> - ![即时目标](<外部 图.svg> "原图标题")',
  '',
  '![分栏目标][ref] ![另一个引用][ref]',
  '',
  '<div><img width="45" alt="阅读目标" src="外部 图.svg"></div>',
  '',
  `![网络目标](${remote}) ![另一个网络引用](${remote})`,
  '',
  '[ref]: <外部 图.svg> "共享标题"',
  '',
  '```md',
  '![示例](<外部 图.svg>)',
  '```',
].join('\r\n')
await mkdir(profile)
await Promise.all([
  writeFile(note, source),
  writeFile(imageFile, svg),
  writeFile(path.join(profile, 'preferences.json'), JSON.stringify({ imageFolder: '附件目录', remoteMedia: true })),
])

const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + profile, ...(executablePath ? [] : [project])]
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(10000)
const live = page.getByLabel('Markdown 即时编辑')
const preview = page.locator('.editor-preview article')
const menu = page.getByRole('menu')
const collect = menu.getByRole('menuitem', { name: '复制到文档资源目录', exact: true })
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
let expected = source

async function action(name) {
  await button('文档与视图').click()
  await button(name, page.locator('.tool-menu-list')).click()
}

async function openImageMenu(root, alt) {
  const image = root.locator(`img[alt="${alt}"]`).filter({ visible: true })
  await image.waitFor()
  await waitForCheck(alt + ' did not render', () => image.evaluate(element => element.complete && element.naturalWidth > 0))
  await waitForCheck(alt + ' image actions did not become available', async () => {
    await image.click({ button: 'right' })
    if (await collect.count()) return true
    await page.keyboard.press('Escape')
    return false
  })
}

async function verifyCollect(root, alt, before, after, bytes = svg) {
  const existing = await readdir(managed).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  await openImageMenu(root, alt)
  if (alt === '即时目标' && process.env.SUJIAN_IMAGE_COLLECTION_SCREENSHOT) {
    await page.screenshot({ path: process.env.SUJIAN_IMAGE_COLLECTION_SCREENSHOT })
  }
  await collect.click()
  await page.getByRole('status').getByText('已复制图片并更新引用', { exact: true }).waitFor()
  const copied = (await readdir(managed)).filter(file => !existing.includes(file))
  assert.equal(copied.length, 1)
  const [file] = copied
  assert.deepEqual(await readFile(path.join(managed, file)), bytes)
  assert.deepEqual(await readFile(imageFile), svg)
  const destination = encodeURIComponent(path.basename(managed)) + '/' + encodeURIComponent(file)
  expected = expected.replace(before, after(destination))
  await action('保存')
  await waitForCheck('Saved Markdown must target only the clicked image', async () => await readFile(note, 'utf8') === expected)
  console.log(alt + ' copied original bytes and updated exactly one image.')
}

try {
  await app.evaluate(({ dialog, protocol }, { file, url, bytes }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    protocol.handle('https', request => request.url === url
      ? new Response(bytes, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } })
      : new Response(null, { status: 404 }))
  }, { file: note, url: remote, bytes: remoteSvg.toString() })
  await page.waitForSelector('.application[data-ready="true"]')
  await action('打开文件')
  await page.getByRole('tab', { name: path.basename(note), selected: true }).waitFor()
  await verifyCollect(live, '即时目标', '![即时目标](<外部 图.svg> "原图标题")',
    destination => `![即时目标](<${destination}> "原图标题")`)
  await openImageMenu(live, '即时目标')
  await collect.click()
  await page.getByRole('status').getByText('图片已在文档资源目录中', { exact: true }).waitFor()
  assert.equal((await readdir(managed)).length, 1)

  await action('分栏预览')
  await verifyCollect(preview, '分栏目标', '![分栏目标][ref]',
    destination => `![分栏目标](${destination} "共享标题")`)

  await action('阅读模式')
  await verifyCollect(preview, '阅读目标', 'src="外部 图.svg"',
    destination => `src="${destination}"`)
  await verifyCollect(preview, '网络目标', `![网络目标](${remote})`,
    destination => `![网络目标](${destination})`, remoteSvg)
  assert.equal((await readdir(managed)).length, 4)
  assert.equal(await readFile(note, 'utf8'), expected)
  assert.deepEqual(await page.locator('.toast.error').allTextContents(), [])
} finally {
  await app.close()
}

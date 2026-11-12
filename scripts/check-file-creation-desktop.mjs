import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { waitForCheck } from './desktop-checks.mjs'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-file-creation-'))
const profile = path.join(working, 'profile')
const root = path.join(working, 'notes')
const child = path.join(root, '会议')
const pinned = path.join(working, '固定目录')
const existing = path.join(root, 'existing.md')
const savedDraft = path.join(root, 'draft.md')
const created = path.join(child, '发布 纪要.md')
const assets = path.join(child, '发布 纪要.assets')
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n5sAAAAASUVORK5CYII='
await Promise.all([mkdir(profile), mkdir(child, { recursive: true }), mkdir(pinned)])
await Promise.all([
  writeFile(existing, '原来的文档。\n'),
  writeFile(path.join(profile, 'preferences.json'), JSON.stringify({ workspace: root, pinned: [pinned] })),
])

const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + profile]
if (!executablePath) args.push(project)
args.push(existing)
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(10000)
const live = page.getByLabel('Markdown 即时编辑')
const row = (name) => page.locator('[data-sidebar-row]').getByText(name, { exact: true })
const dialog = page.getByRole('dialog', { name: '新建文件', exact: true })
const name = dialog.getByRole('textbox', { name: '文件名' })
const submit = dialog.getByRole('button', { name: '创建', exact: true })

async function openCreate(folder, target, keyboard = false) {
  const button = row(folder).locator('..')
  if (keyboard) await button.press('Shift+F10')
  else await button.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '新建文件…', exact: true }).click()
  await dialog.getByText(target, { exact: true }).waitFor()
}

async function waitForSaved(text) {
  await waitForCheck(`Expected to save "${text}" to ${created}`, async () => (await readFile(created, 'utf8')).includes(text))
}

async function save() {
  await page.getByRole('button', { name: '文档与视图', exact: true }).click()
  await page.locator('.tool-menu-list').getByRole('button', { name: '保存', exact: true }).click()
}

try {
  await page.waitForSelector('.application[data-ready="true"]')
  await live.getByText('原来的文档。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '新建文档', exact: true }).click()
  await live.focus()
  await page.keyboard.insertText('普通草稿')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, savedDraft)
  await save()
  await page.getByRole('tab', { name: /draft\.md/ }).waitFor()
  assert.match(await readFile(savedDraft, 'utf8'), /普通草稿/)
  await assert.rejects(access(path.join(root, 'draft.assets')), { code: 'ENOENT' })

  assert.equal(await row('会议').locator('..').getAttribute('aria-expanded'), 'false')
  await openCreate('会议', child)
  await name.fill('发布 纪要')
  await name.press('Enter')
  await dialog.waitFor({ state: 'hidden' })
  await row('发布 纪要.md').first().waitFor()
  await page.getByRole('tab', { name: /发布 纪要\.md/, selected: true }).waitFor()
  assert.deepEqual(await readdir(child), ['发布 纪要.md'])
  assert.equal(await readFile(created, 'utf8'), '')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Markdown 即时编辑')
  await page.keyboard.insertText('在目标目录继续写')
  await save()
  await waitForSaved('在目标目录继续写')
  await assert.rejects(access(assets), { code: 'ENOENT' })

  await openCreate('会议', child)
  await name.fill('发布 纪要.md')
  await submit.click()
  await dialog.getByRole('alert').getByText(/已有同名/).waitFor()
  assert.match(await readFile(created, 'utf8'), /在目标目录继续写/)
  await name.fill('../越界')
  await submit.click()
  await dialog.getByRole('alert').getByText(/有效的/).waitFor()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()

  await row('会议').click()
  await openCreate('notes', root, true)
  await name.fill('根目录.txt')
  await submit.click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('tab', { name: /根目录\.txt/, selected: true }).waitFor()
  assert.equal(await readFile(path.join(root, '根目录.txt'), 'utf8'), '')
  assert.equal(await row('会议').locator('..').getAttribute('aria-expanded'), 'false')

  await openCreate('固定目录', pinned)
  await name.fill('固定的笔记')
  await submit.click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('tab', { name: /固定的笔记\.md/, selected: true }).waitFor()
  assert.deepEqual(await readdir(pinned), ['固定的笔记.md'])

  await page.getByRole('tab', { name: /发布 纪要\.md/ }).click()
  await app.evaluate(({ dialog }) => {
    globalThis.imagePickerCanceled = false
    dialog.showOpenDialog = async () => {
      globalThis.imagePickerCanceled = true
      return { canceled: true, filePaths: [] }
    }
  })
  await page.getByRole('button', { name: '更多编辑工具', exact: true }).click()
  await page.locator('.tool-menu-list').getByRole('button', { name: '插入本地图片', exact: true }).click()
  await waitForCheck('Expected the image picker to be canceled', () => app.evaluate(() => globalThis.imagePickerCanceled))
  await assert.rejects(access(assets), { code: 'ENOENT' })
  await live.focus()
  await live.evaluate((editor, base64) => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], 'pixel.png', { type: 'image/png' }))
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, tinyPng)
  await live.locator('img').waitFor({ state: 'attached' })
  await save()
  await waitForSaved('pixel-')
  const copied = await readdir(assets)
  assert.equal(copied.length, 1)
  assert.deepEqual(await readFile(path.join(assets, copied[0])), Buffer.from(tinyPng, 'base64'))
  assert.match(await readFile(created, 'utf8'), /\.assets\/pixel-[a-f0-9]+\.png/)
  console.log('Passed desktop file creation, exclusive writes, and on-demand image asset folders.')
} finally {
  await app.close()
}

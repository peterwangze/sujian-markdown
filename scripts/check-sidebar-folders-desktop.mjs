import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { waitForCheck } from './desktop-checks.mjs'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-sidebar-folders-'))
const main = path.join(working, '项目资料')
const notes = path.join(working, '参考资料')
const added = path.join(working, '新加入')
const more = path.join(working, '再来一个')
const profile = path.join(working, 'profile')
const preferences = path.join(profile, 'preferences.json')
await Promise.all([mkdir(profile), mkdir(path.join(main, '设计'), { recursive: true }), mkdir(path.join(notes, '归档'), { recursive: true }), mkdir(added), mkdir(more)])
await Promise.all([
  writeFile(preferences, JSON.stringify({ workspace: main, pinned: [notes], sidebar: true, mode: 'source' })),
  writeFile(path.join(main, '索引.md'), '# 项目索引\n'),
  writeFile(path.join(main, '设计', '说明.md'), '# 设计说明\n'),
  writeFile(path.join(notes, '参考.md'), '# 参考资料\n'),
  writeFile(path.join(notes, '归档', '旧文.md'), '# 旧文\n'),
  writeFile(path.join(added, '新笔记.md'), '# 新加入的笔记\n'),
  writeFile(path.join(more, '另一篇.md'), '# 另一篇\n'),
])

const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + profile, ...(executablePath ? [] : [project])]
let app, page
const sidebar = () => page.getByRole('complementary', { name: '文件与大纲' })
const row = name => sidebar().getByRole('button', { name, exact: true }).and(sidebar().locator('[data-level]'))
const pinnedSection = () => sidebar().locator('.sidebar-section').filter({ has: page.getByRole('heading', { name: '固定文件夹', exact: true }) })
const tab = name => page.getByRole('tab', { name, exact: true })
const roots = () => sidebar().locator('[data-level="0"]').evaluateAll(nodes => nodes.map(node => node.textContent))
const saved = () => page.evaluate(() => window.sujian.loadPreferences())
const unpin = name => pinnedRoot(name).getByRole('button', { name: '取消固定', exact: true })
// A folder inside a pinned tree is in the same section, so roots are told apart by their level.
const pinnedRoot = name => pinnedSection().locator('.sidebar-split-row').filter({ has: page.locator('[data-level="0"]').filter({ hasText: name }) })
const grip = () => sidebar().getByRole('separator', { name: '调整侧边栏宽度' })
const width = async () => (await sidebar().boundingBox()).width

async function launch() {
  app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
  page = await app.firstWindow()
  page.setDefaultTimeout(12000)
  await page.waitForSelector('.application[data-ready="true"]')
}

async function menu(name) {
  await page.getByRole('button', { name: '文档与视图', exact: true }).click()
  await page.locator('.tool-menu-list').getByRole('button', { name, exact: true }).click()
}

async function openItems(name) {
  await row(name).click({ button: 'right' })
  await page.getByRole('menu').waitFor()
  return page.getByRole('menu').getByRole('menuitem').allTextContents()
}

async function choose(folder, item) {
  await row(folder).click({ button: 'right' })
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

async function pickFolder(target) {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
  }, target)
}

try {
  await launch()
  await row('参考.md').waitFor()
  // Every folder is a tree of its own, open, with the workspace first.
  assert.deepEqual(await roots(), ['项目资料', '参考资料'])
  assert.equal(await row('参考.md').getAttribute('data-level'), '1')
  assert.equal(await row('归档').getAttribute('data-level'), '1')
  assert.equal(await row('参考资料').getAttribute('title'), notes)
  assert.equal(await row('参考资料').getAttribute('aria-expanded'), 'true')
  assert.equal(await sidebar().getByRole('button', { name: '添加文件夹', exact: true }).count(), 1)
  console.log('The workspace and each pinned folder are open trees beside each other.')

  // Documents open from any tree, and the one open is marked there.
  await row('参考.md').click()
  await tab('参考.md').waitFor()
  assert.equal(await tab('参考.md').getAttribute('aria-selected'), 'true')
  assert.equal(await row('参考.md').getAttribute('aria-current'), 'true')
  assert.equal(await sidebar().locator('[aria-current="true"]').count(), 1)
  await row('归档').click()
  await row('旧文.md').waitFor()
  assert.equal(await row('旧文.md').getAttribute('data-level'), '2')
  await row('旧文.md').click()
  await tab('旧文.md').waitFor()
  await row('索引.md').click()
  await tab('索引.md').waitFor()
  assert.equal(await row('索引.md').getAttribute('aria-current'), 'true')
  assert.equal(await row('旧文.md').getAttribute('aria-current'), null)
  console.log('Documents open from the workspace and from pinned folders, marked where they are.')

  // A pinned folder follows changes made outside the app.
  const created = path.join(notes, '外部新增.md')
  const renamed = path.join(notes, '外部改名.md')
  await writeFile(created, '# 在编辑器外创建\n')
  await row('外部新增.md').waitFor()
  assert.equal(await row('外部新增.md').getAttribute('data-level'), '1')
  await rename(created, renamed)
  await row('外部改名.md').waitFor()
  await row('外部新增.md').waitFor({ state: 'detached' })
  await unlink(renamed)
  await row('外部改名.md').waitFor({ state: 'detached' })
  console.log('A pinned folder follows files created, renamed and removed outside the app.')

  // Context menus: a pinned root makes the folder the workspace or unpins it; the workspace root adds folders.
  const pinnedItems = await openItems('参考资料')
  assert.ok(pinnedItems.includes('设为工作区'), pinnedItems.join(' | '))
  assert.ok(pinnedItems.includes('取消固定'), pinnedItems.join(' | '))
  assert.ok(!pinnedItems.includes('固定文件夹') && !pinnedItems.includes('添加文件夹…'), pinnedItems.join(' | '))
  await page.keyboard.press('Escape')
  const workspaceItems = await openItems('项目资料')
  assert.ok(workspaceItems.includes('添加文件夹…'), workspaceItems.join(' | '))
  assert.ok(workspaceItems.includes('固定文件夹') && !workspaceItems.includes('设为工作区'), workspaceItems.join(' | '))
  await page.keyboard.press('Escape')

  await choose('参考资料', '设为工作区')
  await sidebar().locator('.tree-root [data-level="0"]').getByText('参考资料', { exact: true }).waitFor()
  assert.deepEqual(await roots(), ['参考资料', '项目资料'])
  await row('索引.md').waitFor()
  await row('设计').click()
  await row('说明.md').waitFor()
  await waitForCheck('Expected the new workspace to be saved with the former one pinned', async () => {
    const stored = await saved()
    return stored.workspace === notes && stored.pinned.includes(main) && !stored.pinned.includes(notes)
  })
  assert.equal(await tab('索引.md').getAttribute('aria-selected'), 'true')
  console.log('设为工作区 moves a pinned folder to the top, keeps the former workspace as a tree, and saves both.')

  // New files are created in the folder they are made in.
  await choose('项目资料', '新建文件…')
  const create = page.getByRole('dialog', { name: '新建文件', exact: true })
  await create.getByRole('textbox').fill('固定目录里的新文档.md')
  await create.getByRole('button', { name: /创建|确定/ }).click()
  await tab('固定目录里的新文档.md').waitFor()
  assert.equal(await readFile(path.join(main, '固定目录里的新文档.md'), 'utf8'), '')
  console.log('新建文件 in a pinned folder creates the document there and opens it.')

  // 添加文件夹 adds a tree; the workspace stays.
  await pickFolder(added)
  await row('参考资料').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '添加文件夹…', exact: true }).click()
  await row('新笔记.md').waitFor()
  assert.deepEqual(await roots(), ['参考资料', '项目资料', '新加入'])
  await waitForCheck('Expected the added folder to be saved as pinned', async () =>
    (await saved()).workspace === notes && (await saved()).pinned.includes(added))
  await pickFolder(more)
  await sidebar().getByRole('button', { name: '添加文件夹', exact: true }).click()
  await row('另一篇.md').waitFor()
  assert.deepEqual(await roots(), ['参考资料', '项目资料', '新加入', '再来一个'])
  console.log('添加文件夹 by the menu and by the sidebar button adds trees and leaves the workspace alone.')

  // A folder inside a tree can be pinned as a tree of its own, and unpinned again.
  await choose('设计', '固定文件夹')
  await pinnedRoot('设计').waitFor()
  assert.deepEqual(await roots(), ['参考资料', '项目资料', '新加入', '再来一个', '设计'])
  // The folder stays where it was, and is a tree of its own as well.
  await row('说明.md').nth(1).waitFor()
  assert.equal(await row('说明.md').count(), 2)
  assert.equal(await row('说明.md').nth(1).getAttribute('data-level'), '1')
  await unpin('设计').click()
  await pinnedRoot('设计').waitFor({ state: 'detached' })
  assert.equal(await row('说明.md').count(), 1)
  console.log('固定文件夹 on a folder inside a tree gives it a tree of its own; 取消固定 removes it.')

  await unpin('再来一个').click()
  await row('另一篇.md').waitFor({ state: 'detached' })
  await unpin('新加入').click()
  await row('新笔记.md').waitFor({ state: 'detached' })
  assert.deepEqual(await roots(), ['参考资料', '项目资料'])
  await waitForCheck('Expected the removed folders to be forgotten', async () => {
    const stored = await saved()
    return stored.pinned.length === 1 && stored.pinned.includes(main)
  })
  console.log('取消固定 removes a tree and its files from the sidebar, and is saved.')

  // Dragging the edge of the sidebar sets its width.
  const before = await width()
  const edge = await grip().boundingBox()
  assert.equal(await grip().getAttribute('aria-valuenow'), String(before))
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 300)
  await page.mouse.down()
  await page.mouse.move(edge.x + edge.width / 2 + 90, edge.y + 300, { steps: 6 })
  await page.mouse.up()
  await waitForCheck('Expected the dragged width to be saved', async () => (await saved()).sidebarWidth === before + 90)
  assert.equal(await width(), before + 90)
  assert.equal(await grip().getAttribute('aria-valuenow'), String(before + 90))
  await page.mouse.move(edge.x + edge.width / 2 + 300, edge.y + 300)
  assert.equal(await width(), before + 90)
  console.log('Dragging the edge resizes the sidebar and saves the width; moving the pointer on leaves it.')

  // The width survives a restart.
  await app.close()
  await launch()
  await row('参考.md').waitFor()
  assert.equal(await width(), before + 90)
  console.log('The width is restored on the next start.')

  // With the keyboard: arrows by 16, Shift by 64, Home and End to the limits.
  await grip().focus()
  await page.keyboard.press('ArrowLeft')
  assert.equal(await width(), before + 74)
  await page.keyboard.press('Shift+ArrowLeft')
  assert.equal(await width(), before + 10)
  await page.keyboard.press('Shift+ArrowRight')
  assert.equal(await width(), before + 74)
  await page.keyboard.press('Home')
  assert.equal(await width(), 150)
  assert.equal(await grip().getAttribute('aria-valuenow'), '150')
  await page.keyboard.press('End')
  const viewport = await page.evaluate(() => innerWidth)
  assert.equal(await width(), Math.min(640, viewport - 480))
  await page.keyboard.press('ArrowRight')
  assert.equal(await width(), Math.min(640, viewport - 480))
  console.log('With the keyboard the separator moves the width by steps and to both limits.')

  // The editor keeps its room when the window is narrow.
  assert.equal(await width(), Math.min(640, viewport - 480))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 760))
  await waitForCheck('Expected the sidebar to yield room to the editor', async () => (await width()) === 420)
  assert.equal(await grip().getAttribute('aria-valuenow'), '420')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1320, 900))
  await waitForCheck('Expected the sidebar to return to its width', async () => (await width()) === Math.min(640, viewport - 480))
  console.log('A narrow window limits the sidebar to leave the editor its room; widening restores the chosen width.')

  // A double click returns to the default.
  await grip().dblclick()
  await waitForCheck('Expected the default width to be saved', async () => (await saved()).sidebarWidth === null)
  assert.equal(await width(), before)
  console.log('A double click on the edge returns the sidebar to its default width.')
  console.log('Acceptance artifacts: ' + working)
} finally {
  await app.close().catch(() => {})
}

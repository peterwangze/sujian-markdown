import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rename, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { waitForCheck } from './desktop-checks.mjs'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-sidebar-tree-'))
const workspace = path.join(working, '项目资料')
const pinnedWorkspace = path.join(working, '固定资料')
const pinnedNote = '固定索引.md'
const folders = ['设计', '界面', '评审记录', '发布清单', '第一轮', '修改版', '归档']
const notes = ['索引.md', '设计说明.md', '界面稿.md', '验收笔记.md', '复核.md', '记录.md', '修订.md', '一份很长的发布说明.md']
const paths = [workspace]
for (const folder of folders) paths.push(path.join(paths.at(-1), folder))
const profile = path.join(working, 'profile')
await Promise.all([mkdir(profile), mkdir(paths.at(-1), { recursive: true }), mkdir(pinnedWorkspace)])
await Promise.all([
  writeFile(path.join(profile, 'preferences.json'), JSON.stringify({
    workspace, pinned: [workspace, pinnedWorkspace], sidebar: true, mode: 'source',
  })),
  writeFile(path.join(pinnedWorkspace, pinnedNote), '# 固定资料索引\n'),
  ...paths.map((folder, index) => writeFile(path.join(folder, notes[index]), `# ${notes[index]}\n`)),
])

const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + profile, ...(executablePath ? [] : [project])]
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(10000)
const sidebar = page.getByRole('complementary', { name: '文件与大纲' })
const treeRow = name => sidebar.getByRole('button', { name, exact: true }).and(sidebar.locator('[data-level]'))
const tab = name => page.getByRole('tab', { name, exact: true })

async function positions(row) {
  return row.evaluate(button => {
    const label = button.lastElementChild
    const icon = label.previousElementSibling
    return {
      icon: icon.getBoundingClientRect().x,
      label: label.getBoundingClientRect().x,
      labelWidth: label.clientWidth,
      textWidth: label.scrollWidth,
      overflow: getComputedStyle(label).textOverflow,
    }
  })
}

async function checkExternalFileChanges(directory, prefix, level) {
  const createdName = prefix + '新增.md'
  const renamedName = prefix + '改名.md'
  const createdPath = path.join(directory, createdName)
  const renamedPath = path.join(directory, renamedName)
  const created = treeRow(createdName)
  const renamed = treeRow(renamedName)

  await writeFile(createdPath, '# 在编辑器外创建\n')
  await created.waitFor()
  assert.equal(await created.getAttribute('data-level'), String(level))
  assert.equal(await created.getAttribute('title'), createdPath)

  await rename(createdPath, renamedPath)
  await renamed.waitFor()
  await created.waitFor({ state: 'detached' })
  assert.equal(await renamed.getAttribute('data-level'), String(level))
  assert.equal(await renamed.getAttribute('title'), renamedPath)

  await unlink(renamedPath)
  await renamed.waitFor({ state: 'detached' })
}

try {
  await page.waitForSelector('.application[data-ready="true"]')
  await treeRow(notes[0]).waitFor()
  for (let depth = 0; depth < 4; depth++) {
    const folder = treeRow(folders[depth])
    const sibling = treeRow(notes[depth])
    const aligned = await positions(folder)
    assert.equal((await positions(sibling)).icon, aligned.icon, `Folder and file icons at depth ${depth + 1}`)
    assert.equal((await positions(sibling)).label, aligned.label, `Folder and file labels at depth ${depth + 1}`)
    await folder.press('ArrowRight')
    const child = treeRow(notes[depth + 1])
    await child.waitFor()
    const nested = await positions(child)
    assert.ok(nested.icon - aligned.icon >= 12, `File icon does not visibly indent at depth ${depth + 2}`)
    assert.ok(nested.label - aligned.label >= 12, `File label does not visibly indent at depth ${depth + 2}`)
  }

  const folder = treeRow(folders[3])
  const childFolder = treeRow(folders[4])
  await folder.press('ArrowRight')
  assert.equal(await childFolder.evaluate(element => element === document.activeElement), true)
  await childFolder.press('ArrowLeft')
  assert.equal(await folder.evaluate(element => element === document.activeElement), true)

  const displayed = treeRow(notes[4])
  await displayed.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: '操作 ' + notes[4] })
  await menu.getByRole('menuitem', { name: '打开文档', exact: true }).click()
  assert.equal(await tab(notes[4]).getAttribute('aria-selected'), 'true')

  if (process.env.SUJIAN_TREE_SCREENSHOT) {
    const bounds = await sidebar.boundingBox()
    const lastRow = await treeRow(notes[0]).boundingBox()
    await page.screenshot({ path: process.env.SUJIAN_TREE_SCREENSHOT, scale: 'css', clip: {
      x: bounds.x, y: bounds.y, width: bounds.width, height: lastRow.y + lastRow.height - bounds.y + 10,
    } })
  }

  await displayed.focus()
  await checkExternalFileChanges(workspace, '工作区外部', 1)
  await checkExternalFileChanges(paths[4], '展开目录外部', 5)
  for (const name of [path.basename(workspace), ...folders.slice(0, 4)]) {
    assert.equal(await treeRow(name).getAttribute('aria-expanded'), 'true')
  }
  assert.equal(await displayed.getAttribute('aria-current'), 'true')
  assert.equal(await displayed.evaluate(element => element === document.activeElement), true)
  assert.equal(await tab(notes[4]).getAttribute('aria-selected'), 'true')
  console.log('External file creation, rename and deletion refreshed the workspace root and expanded directories, retaining expansion, focus and the current document.')

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(850, 800))
  await page.waitForFunction(() => window.innerWidth <= 960)
  for (const name of folders.slice(4)) await treeRow(name).press('ArrowRight')
  const deepest = treeRow(notes.at(-1))
  await deepest.waitFor()
  const measured = await positions(deepest)
  assert.ok(measured.label > (await positions(treeRow(folders.at(-1)))).label)
  assert.ok(measured.labelWidth > 15, 'The last row has room for its filename')
  assert.ok(measured.textWidth > measured.labelWidth)
  assert.equal(measured.overflow, 'ellipsis')
  await deepest.locator('span').last().scrollIntoViewIfNeeded()
  await waitForCheck('Deep rows should be reachable by horizontal scroll', () => sidebar.locator('.sidebar-content').evaluate(content =>
    content.scrollWidth > content.clientWidth && content.scrollLeft > 0))
  assert.equal(await deepest.getAttribute('title'), path.join(paths.at(-1), notes.at(-1)))
  await deepest.press('Enter')
  assert.equal(await tab(notes.at(-1)).getAttribute('aria-selected'), 'true')

  await sidebar.getByRole('button', { name: '切换文件列表', exact: true }).click()
  await treeRow(notes.at(-1)).waitFor()
  const flatRoot = await positions(treeRow(notes[0]))
  const flatDeepest = await positions(treeRow(notes.at(-1)))
  assert.equal(flatRoot.icon, flatDeepest.icon)
  assert.equal(flatRoot.label, flatDeepest.label)
  assert.equal(await treeRow(folders[0]).count(), 0)
  console.log('Nested sidebar icons and labels align across sibling types and indent per level. Narrow layout, focus, context menu and flat list passed.')

  await checkExternalFileChanges(paths.at(-1), '文件列表外部', 1)
  assert.equal(await tab(notes.at(-1)).getAttribute('aria-selected'), 'true')
  console.log('Flat mode observes changes in deep folders without expanding folder branches.')

  await sidebar.getByRole('button', { name: '切换文件树', exact: true }).click()
  const pinned = sidebar.locator('.sidebar-section').filter({
    has: page.getByRole('heading', { name: '固定文件夹', exact: true }),
  })
  const pinnedRoot = treeRow(path.basename(pinnedWorkspace))
  // The workspace is pinned in this profile. It is shown once, at the top.
  assert.equal(await pinned.getByRole('button', { name: path.basename(workspace), exact: true }).count(), 0)
  assert.equal(await pinnedRoot.getAttribute('data-level'), '0')
  assert.equal(await pinnedRoot.getAttribute('aria-expanded'), 'true')
  assert.equal(await pinnedRoot.getAttribute('title'), pinnedWorkspace)
  await treeRow(pinnedNote).click()
  await tab(pinnedNote).waitFor()
  const workspaceNote = '固定之后在原工作区创建.md'
  const workspaceNotePath = path.join(workspace, workspaceNote)
  await writeFile(workspaceNotePath, '# 固定之后在原工作区创建\n')
  await treeRow(workspaceNote).waitFor()
  await checkExternalFileChanges(pinnedWorkspace, '固定目录外部', 1)
  assert.equal(await pinnedRoot.getAttribute('aria-expanded'), 'true')
  assert.equal(await treeRow(pinnedNote).getAttribute('aria-current'), 'true')
  assert.equal(await tab(pinnedNote).getAttribute('aria-selected'), 'true')

  // A pinned folder folds like any other, and the open document stays marked.
  await pinnedRoot.click()
  await treeRow(pinnedNote).waitFor({ state: 'detached' })
  assert.equal(await pinnedRoot.getAttribute('aria-expanded'), 'false')
  assert.equal(await tab(pinnedNote).getAttribute('aria-selected'), 'true')
  await pinnedRoot.press('ArrowRight')
  await treeRow(pinnedNote).waitFor()
  assert.equal(await pinnedRoot.getAttribute('aria-expanded'), 'true')
  await treeRow(pinnedNote).press('ArrowLeft')
  // Left from a file moves to its folder, as in the rest of the tree.
  assert.equal(await pinnedRoot.evaluate(row => row === document.activeElement), true)
  assert.equal(await pinnedRoot.getAttribute('aria-expanded'), 'true')
  await pinnedRoot.press('ArrowLeft')
  assert.equal(await pinnedRoot.getAttribute('aria-expanded'), 'false')
  await pinnedRoot.click()
  await unlink(workspaceNotePath)
  await treeRow(workspaceNote).waitFor({ state: 'detached' })
  await pinned.getByRole('button', { name: '取消固定', exact: true }).click()
  await pinned.waitFor({ state: 'hidden' })
  await treeRow(pinnedNote).waitFor({ state: 'detached' })
  console.log('Pinned folders are trees beside the workspace: both follow outside changes, fold by pointer and keyboard, and unpinning removes the tree.')
} finally {
  await app.close()
}

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { _electron } from 'playwright'
import { waitForCheck } from './desktop-checks.mjs'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const fixtureRoot = process.env.SUJIAN_GIT_TEST_ROOT || tmpdir()
const working = await mkdtemp(path.join(fixtureRoot, 'sujian-git-workspace-'))
const profile = path.join(working, 'profile')
const root = path.join(working, '项目笔记')
const chapter = path.join(root, '项目章节')
const independent = path.join(working, '资料集合')
const nested = path.join(independent, '独立草稿')
const note = '写作计划.md'
const added = '项目说明.md'
const ignored = '私有备忘.md'
const nestedNote = '内层纪要.md'
const outside = '仓外文件.md'
const initialText = '# 写作计划\n\n提交时的正文。\n'
const updatedText = '给下一次提交的已保存正文。'
const draftText = '提交之后继续写的草稿。'
const git = promisify(execFile)
const testEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)))

async function gitRun(directory, ...args) {
  const { stdout } = await git('git', ['-C', directory, ...args], { env: testEnvironment, windowsHide: true })
  return stdout.trimEnd()
}

async function configureAuthor(directory) {
  await gitRun(directory, 'config', '--local', 'user.name', 'Sujian Desktop Test')
  await gitRun(directory, 'config', '--local', 'user.email', 'desktop@example.invalid')
  await gitRun(directory, 'config', '--local', 'commit.gpgsign', 'false')
}

await Promise.all([mkdir(profile), mkdir(chapter, { recursive: true }), mkdir(nested, { recursive: true })])
await Promise.all([
  writeFile(path.join(root, note), initialText),
  writeFile(path.join(root, ignored), '只留在本机。\n'),
  writeFile(path.join(root, '.gitignore'), ignored + '\n'),
  writeFile(path.join(chapter, '章节.md'), '# 仓库中的章节\n'),
  writeFile(path.join(nested, nestedNote), '# 内层纪要\n\n给子目录单独建仓。\n'),
  writeFile(path.join(independent, outside), '# 始终留在仓外\n'),
  writeFile(path.join(profile, 'preferences.json'), JSON.stringify({ workspace: root, sidebar: true, mode: 'source', autoSave: false })),
])

const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + profile, ...(executablePath ? [] : [project]), path.join(root, note)]
const app = await _electron.launch({ args, env: testEnvironment, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(12000)
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const folder = name => button(name, page.getByRole('complementary', { name: '文件与大纲' })).and(page.locator('[data-level]'))
const menu = page.getByRole('menu')
const management = page.getByRole('dialog', { name: 'Git 版本管理', exact: true })
const review = page.getByRole('dialog', { name: '审阅修订稿', exact: true })
const source = page.getByLabel('Markdown 源码')
const commit = button('暂存并提交', management)
const message = management.getByRole('textbox', { name: '提交说明' })

async function openGit(name, keyboard = false) {
  if (keyboard) await folder(name).press('Shift+F10')
  else await folder(name).click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Git 版本管理…', exact: true }).click()
  await management.waitFor()
}

async function endGit() {
  if (await management.isVisible()) await button('关闭', management).click()
  await management.waitFor({ state: 'hidden' })
}

async function initialize(directory) {
  await button('初始化 Git 仓库', management).click()
  await waitForCheck('Git 初始化未创建本地仓库', async () => {
    const result = await gitRun(directory, 'rev-parse', '--is-inside-work-tree').catch(() => '')
    return result === 'true'
  })
  const topLevel = await gitRun(directory, 'rev-parse', '--show-toplevel')
  assert.equal(path.normalize(topLevel), path.normalize(directory))
  await assert.rejects(gitRun(directory, 'rev-parse', '--verify', 'HEAD'))
  assert.equal(await gitRun(directory, 'remote'), '')
}

async function submit(directory, text, count) {
  await message.fill(text)
  await commit.click()
  await waitForCheck('Git 日志未出现预期提交', async () => {
    const current = await gitRun(directory, 'log', '-1', '--format=%s').catch(() => '')
    return current === text
  })
  assert.equal(await gitRun(directory, 'rev-list', '--count', 'HEAD'), String(count))
  assert.equal(await gitRun(directory, 'status', '--porcelain'), '')
}

async function openWorkspace(directory, name) {
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
  }, directory)
  // "打开文件夹" replaces the workspace. The sidebar's button adds a folder beside it.
  await button('文档与视图').click()
  await button('打开文件夹', page.locator('.tool-menu-list')).click()
  await folder(name).waitFor()
}

async function appendSource(text) {
  await source.focus()
  await source.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
  await page.keyboard.insertText(text + '\n')
}

try {
  await page.waitForSelector('.application[data-ready="true"]')
  await source.getByText('提交时的正文。', { exact: true }).waitFor()
  await openGit('项目笔记')
  await initialize(root)
  await endGit()
  await configureAuthor(root)
  await openGit('项目笔记')
  await management.getByText(note, { exact: true }).waitFor()
  assert.equal(await management.getByText(ignored, { exact: true }).count(), 0)
  if (process.env.SUJIAN_GIT_WORKSPACE_SCREENSHOT) {
    await message.fill('建立项目笔记基线')
    await management.screenshot({ path: process.env.SUJIAN_GIT_WORKSPACE_SCREENSHOT })
  }
  await submit(root, '建立项目笔记基线', 1)
  assert.equal(await gitRun(root, 'show', `HEAD:${note}`), initialText.trimEnd())
  assert.match(await gitRun(root, 'ls-files'), /\.gitignore/)
  await assert.rejects(gitRun(root, 'show', `HEAD:${ignored}`))
  await endGit()

  await appendSource(updatedText)
  await writeFile(path.join(root, added), '# 项目说明\n\n新增待提交文件。\n')
  await openGit('项目笔记')
  const saveAndRefresh = button('保存后刷新', management)
  await saveAndRefresh.waitFor()
  assert.equal(await commit.isDisabled(), true)
  assert.equal(await readFile(path.join(root, note), 'utf8'), initialText)
  await saveAndRefresh.click()
  await waitForCheck('刷新提交前没有保存文档', async () =>
    await readFile(path.join(root, note), 'utf8') === initialText + updatedText + '\n')
  await management.getByText(added, { exact: true }).waitFor()
  await submit(root, '更新笔记并添加说明', 2)
  assert.equal(await gitRun(root, 'show', `HEAD:${note}`), (initialText + updatedText).trimEnd())
  assert.equal(await gitRun(root, 'show', `HEAD:${added}`), '# 项目说明\n\n新增待提交文件。')
  await endGit()

  await openGit('项目章节')
  await management.getByText('此目录属于以下 Git 仓库。请到仓库根目录提交修改。', { exact: true }).waitFor()
  assert.equal(await button('初始化 Git 仓库', management).count(), 0)
  assert.equal(await commit.count(), 0)
  await assert.rejects(access(path.join(chapter, '.git')), { code: 'ENOENT' })
  await endGit()

  await appendSource(draftText)
  await openGit('项目笔记')
  await button('比较当前文档与 HEAD', management).click()
  await review.waitFor()
  assert.equal(await review.getByLabel('Git 版本', { exact: true }).inputValue(), 'HEAD')
  await review.getByText(/^HEAD · [a-f0-9]{8}$/).waitFor()
  await review.getByLabel('当前稿').filter({ hasText: draftText }).waitFor()
  assert.doesNotMatch(await gitRun(root, 'show', `HEAD:${note}`), new RegExp(draftText, 'u'))
  await button('结束审阅', review).click()
  console.log('Workspace initialization, two local commits, ignored files, unsaved changes, and HEAD review passed.')

  await openWorkspace(independent, '资料集合')
  await openGit('独立草稿', true)
  await initialize(nested)
  await assert.rejects(access(path.join(independent, '.git')), { code: 'ENOENT' })
  await endGit()
  await gitRun(nested, 'config', '--local', 'user.useConfigOnly', 'true')
  await gitRun(nested, 'config', '--local', 'user.name', '')
  await gitRun(nested, 'config', '--local', 'user.email', '')
  await openGit('独立草稿', true)
  await management.getByText(nestedNote, { exact: true }).waitFor()
  await management.getByText(/Git 作者身份尚未配置/).waitFor()
  assert.equal(await commit.isDisabled(), true)
  await assert.rejects(gitRun(nested, 'rev-parse', '--verify', 'HEAD'))
  await endGit()
  await configureAuthor(nested)
  await openGit('独立草稿', true)
  await management.getByText(nestedNote, { exact: true }).waitFor()
  assert.equal(await management.getByText(outside, { exact: true }).count(), 0)
  await submit(nested, '保存内层纪要基线', 1)
  assert.equal(await gitRun(nested, 'show', `HEAD:${nestedNote}`), '# 内层纪要\n\n给子目录单独建仓。')
  assert.equal(await gitRun(nested, 'remote'), '')
  await assert.rejects(access(path.join(independent, '.git')), { code: 'ENOENT' })
  assert.equal(await readFile(path.join(independent, outside), 'utf8'), '# 始终留在仓外\n')
  if (!await management.isVisible()) await openGit('独立草稿', true)
  await button('打开为工作区', management).click()
  await page.locator('.tree-root [data-level="0"]').getByText('独立草稿', { exact: true }).waitFor()
  await folder(nestedNote).waitFor()
  assert.equal(await folder(outside).count(), 0)
  console.log('Subdirectory initialization, identity check, commit, and opening as a workspace passed; the parent was untouched.')
} catch (error) {
  const alerts = await page.getByRole('alert').allTextContents()
  if (alerts.length) console.error('Desktop error:', alerts.join('\n'))
  throw error
} finally {
  await app.close()
}

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { _electron } from 'playwright'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const fixtureRoot = process.env.SUJIAN_GIT_TEST_ROOT || tmpdir()
const working = await mkdtemp(path.join(fixtureRoot, 'sujian-document-history-'))
const repo = path.join(working, '文档历史示例')
const profile = path.join(working, 'profile')
const oldName = '产品计划 旧版.md'
const note = '产品计划.md'
const background = '验收记录.md'
const untracked = '临时构思.md'
const outside = path.join(working, '仓库外笔记.md')
const subject = {
  first: '建立产品计划初稿',
  oldEdit: '补充产品计划范围',
  rename: '整理产品计划文件名',
  current: '更新产品计划里程碑',
  background: '补充验收记录',
  unrelated: '更新项目索引',
}
const firstText = '# 产品计划\n\n先验证基础编写流程。\n'
const oldEditText = firstText + '\n纳入文件级的 Git 历史。\n'
const currentText = '# 产品计划\n\n里程碑一已完成，进入文档审阅。\n'
const draftLine = '未保存的草稿补充说明。'
const backgroundOriginal = '# 验收记录\n\n初稿中记录了三项检查。\n'
const backgroundText = '# 验收记录\n\n当前记录覆盖五项检查。\n'
const executablePath = process.env.SUJIAN_QA_EXE
const git = promisify(execFile)
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)))

async function gitRun(...args) {
  const { stdout } = await git('git', ['-C', repo, ...args], { env, windowsHide: true })
  return stdout.trimEnd()
}

async function commit(message) {
  await gitRun('add', '-A')
  await gitRun('commit', '-qm', message)
  return gitRun('rev-parse', 'HEAD')
}

await Promise.all([mkdir(repo), mkdir(profile)])
await gitRun('init', '-q', '--template=')
await gitRun('config', '--local', 'user.name', 'Sujian QA')
await gitRun('config', '--local', 'user.email', 'desktop@example.invalid')
await gitRun('config', '--local', 'commit.gpgsign', 'false')
await gitRun('config', '--local', 'core.autocrlf', 'false')
await gitRun('config', '--local', 'core.hooksPath', path.join(repo, '.git', 'qa-hooks'))

await Promise.all([
  writeFile(path.join(repo, oldName), firstText),
  writeFile(path.join(repo, background), backgroundOriginal),
  writeFile(path.join(repo, '索引.md'), '# 项目索引\n'),
  writeFile(outside, '# 仓库外笔记\n'),
  writeFile(path.join(profile, 'preferences.json'), JSON.stringify({ workspace: repo, sidebar: true, mode: 'source', autoSave: false })),
])
const firstHash = await commit(subject.first)
await writeFile(path.join(repo, oldName), oldEditText)
const oldEditHash = await commit(subject.oldEdit)
await writeFile(path.join(repo, background), backgroundText)
await commit(subject.background)
await rename(path.join(repo, oldName), path.join(repo, note))
await commit(subject.rename)
await writeFile(path.join(repo, note), currentText)
await commit(subject.current)
await writeFile(path.join(repo, '索引.md'), '# 项目索引\n\n补充导航项。\n')
const head = await commit(subject.unrelated)
await writeFile(path.join(repo, untracked), '# 临时构思\n')
const diskStatus = await gitRun('status', '--porcelain=v1')
const stagedEntries = await gitRun('ls-files', '--stage', '-z')

const args = ['--user-data-dir=' + profile, ...(executablePath ? [] : [project]), path.join(repo, note)]
const app = await _electron.launch({ args, env, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(12000)
const tab = name => page.getByRole('tab').filter({ hasText: name })
const selectedTab = page.getByRole('tab', { selected: true })
const sidebar = page.getByRole('complementary', { name: '文件与大纲' })
const row = name => sidebar.getByRole('button', { name, exact: true }).and(sidebar.locator('[data-level]'))
const history = page.getByRole('dialog', { name: 'Git 提交历史', exact: true })
const review = page.getByRole('dialog', { name: '审阅修订稿', exact: true })
const source = page.getByLabel('Markdown 源码')
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const historyEntry = title => history.getByRole('button').filter({ hasText: title })

async function openHistory(entry, document, keyboard = false) {
  if (keyboard) await entry.press('Shift+F10')
  else await entry.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: '操作 ' + document })
  const command = menu.getByRole('menuitem', { name: 'Git 提交历史', exact: true })
  if (keyboard) await command.press('Enter')
  else await command.click()
  await history.waitFor()
}

async function assertComparison(title, oldLine, currentLine, keyboard = false) {
  const entry = historyEntry(title)
  if (keyboard) await entry.press('Enter')
  else await entry.click()
  await review.waitFor()
  await review.getByLabel('Git 基线', { exact: true }).filter({ hasText: oldLine }).waitFor()
  await review.getByLabel('当前稿', { exact: true }).filter({ hasText: currentLine }).waitFor()
  assert.equal(await button('应用已采纳改动', review).count(), 0)
}

try {
  await page.waitForSelector('.application[data-ready="true"]')
  await source.getByText('里程碑一已完成，进入文档审阅。', { exact: true }).waitFor()
  await source.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
  await page.keyboard.insertText('\n' + draftLine + '\n')
  await source.getByText(draftLine, { exact: true }).waitFor()

  await openHistory(tab(note), note)
  const entriesInOrder = [subject.current, subject.rename, subject.oldEdit, subject.first]
  await Promise.all(entriesInOrder.map(title => historyEntry(title).waitFor()))
  const ordered = (await history.getByRole('button').allTextContents()).flatMap(text => entriesInOrder.filter(title => text.includes(title)))
  assert.deepEqual(ordered, entriesInOrder)
  assert.equal(await historyEntry(subject.background).count(), 0)
  assert.equal(await historyEntry(subject.unrelated).count(), 0)
  await historyEntry(subject.oldEdit).getByText(oldEditHash.slice(0, 8), { exact: false }).waitFor()
  await historyEntry(subject.oldEdit).getByText('Sujian QA', { exact: false }).waitFor()
  if (process.env.SUJIAN_GIT_HISTORY_SCREENSHOT) {
    await history.screenshot({ path: process.env.SUJIAN_GIT_HISTORY_SCREENSHOT })
  }
  await assertComparison(subject.oldEdit, '纳入文件级的 Git 历史。', draftLine)
  assert.equal(await button('Git 比较', review).getAttribute('aria-pressed'), 'true')
  assert.equal(await review.getByLabel('Git 版本', { exact: true }).count(), 0)
  await button('排版预览', review).click()
  await review.getByRole('region', { name: 'Git 基线', exact: true }).getByText('纳入文件级的 Git 历史。', { exact: true }).waitFor()
  await review.getByRole('region', { name: '当前稿', exact: true }).getByText(draftLine).waitFor()
  await button('返回提交历史', review).click()
  await history.waitFor()
  await assertComparison(subject.first, '先验证基础编写流程。', draftLine)
  await button('结束审阅', review).click()
  await source.getByText(draftLine, { exact: true }).waitFor()
  assert.equal(await readFile(path.join(repo, note), 'utf8'), currentText)
  console.log('Tab history excludes unrelated commits and opens the renamed baseline against the unsaved draft in source and rendered review.')

  assert.equal(await tab(background).count(), 0)
  await openHistory(row(background), background, true)
  await historyEntry(subject.background).waitFor()
  assert.equal(await historyEntry(subject.current).count(), 0)
  await assertComparison(subject.first, '初稿中记录了三项检查。', '当前记录覆盖五项检查。', true)
  await review.getByText(new RegExp(firstHash.slice(0, 8))).first().waitFor()
  await tab(note).and(selectedTab).waitFor()
  await button('结束审阅', review).click()
  await tab(note).and(selectedTab).waitFor()
  assert.equal(await readFile(path.join(repo, background), 'utf8'), backgroundText)

  await openHistory(row(untracked), untracked)
  await history.getByText('当前文档在此 Git 分支中还没有提交记录。', { exact: true }).waitFor()
  await button('关闭', history).click()
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
  }, outside)
  await button('文档与视图').click()
  await button('打开文件', page.locator('.tool-menu-list')).click()
  await openHistory(tab(path.basename(outside)), path.basename(outside))
  await history.getByText('当前文档不在 Git 工作区中。', { exact: true }).waitFor()
  await button('关闭', history).click()
  assert.equal(await gitRun('rev-parse', 'HEAD'), head)
  assert.equal(await gitRun('status', '--porcelain=v1'), diskStatus)
  assert.equal(await gitRun('ls-files', '--stage', '-z'), stagedEntries)
  assert.equal(await readFile(path.join(repo, note), 'utf8'), currentText)
  console.log('Keyboard history targets an unopened background document, handles untracked and non-repository documents, and leaves HEAD and working-tree files intact.')
} catch (error) {
  const alerts = await page.getByRole('alert').allTextContents()
  if (alerts.length) console.error('Desktop error:', alerts.join('\n'))
  throw error
} finally {
  await app.close()
}

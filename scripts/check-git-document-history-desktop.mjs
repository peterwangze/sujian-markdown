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
const restoreNote = '发布说明.md'
const restorePath = path.join(repo, restoreNote)
const longNote = '交接指南.md'
const longPath = path.join(repo, longNote)
const outside = path.join(working, '仓库外笔记.md')
const subject = {
  first: '建立产品计划初稿',
  oldEdit: '补充产品计划范围',
  rename: '整理产品计划文件名',
  current: '更新产品计划里程碑',
  background: '补充验收记录',
  restoreBase: '确定试用发布说明',
  restoreCurrent: '更新发布说明的范围和节奏',
  longBase: '编写长期交接指南',
  longCurrent: '更新交接日期和归档状态',
  unrelated: '更新项目索引',
}
const firstText = '# 产品计划\n\n先验证基础编写流程。\n'
const oldEditText = firstText + '\n纳入文件级的 Git 历史。\n'
const currentText = '# 产品计划\n\n里程碑一已完成，进入文档审阅。\n'
const draftLine = '未保存的草稿补充说明。'
const backgroundOriginal = '# 验收记录\n\n初稿中记录了三项检查。\n'
const backgroundText = '# 验收记录\n\n当前记录覆盖五项检查。\n'
const oldScope = '首批试用覆盖写作与导出。'
const latestScope = '首批试用只覆盖写作。'
const oldGuide = '阅读 **试用指南**，并查看 [报名入口](https://example.com/preview)。'
const latestGuide = '阅读 **发布指南**，并查看 [反馈入口](https://example.com/preview)。'
const unchangedGuide = '发布说明中的平台要求继续适用。'
const oldTimeline = '每周收集一次试用反馈。'
const latestTimeline = '首周每天收集一次试用反馈。'
const removedLine = '- 首轮报名须提交纸质回执。'
const oldListItem = '现场收集反馈。'
const latestListItem = '线上收集反馈。'
const oldTableRow = '| 回访 | 每周 |'
const latestTableRow = '| 回访 | 每天 |'
const restoreBaseline = [
  '# 发布说明', '', '## 试用范围', '', oldScope, '', oldGuide, '', unchangedGuide, '',
  '## 反馈节奏', '', oldTimeline, '', '- 报名和回访通过项目页面安排。', removedLine,
  '- 试用期间保留原有的本地保存流程。', '- ' + oldListItem, '',
  '| 项目 | 频率 |', '| --- | --- |', oldTableRow, '',
  '下一批试用安排将单独公布。', '',
].join('\n')
const restoreCurrent = restoreBaseline.replace(oldScope, latestScope).replace(oldGuide, latestGuide)
  .replace(oldTimeline, latestTimeline).replace(removedLine + '\n', '')
  .replace(oldListItem, latestListItem).replace(oldTableRow, latestTableRow)
const selectiveDraft = '\n支持渠道继续收集安装反馈。\n'
const fullDraft = '\n周五再确认下一批试用名单。\n'
const selectivelyRestored = restoreCurrent.replace(latestScope, oldScope) + selectiveDraft
const longParagraph = index => `第 ${index} 条交接说明用于记录工作区的常规资料。`
const longBaseline = [
  '# 交接指南', '', Array.from({ length: 720 }, (_, index) => longParagraph(index + 1)).join('\n\n'), '',
  '交接日期定在周三。', '', '- 后备地区使用测试库。', '',
  '| 项目 | 状态 |', '| --- | --- |', '| 归档 | 待完成 |', '',
].join('\n')
const longCurrent = longBaseline.replace('周三', '周五').replace('测试库', '归档库').replace('待完成', '已完成')
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
await writeFile(restorePath, restoreBaseline)
await commit(subject.restoreBase)
await writeFile(restorePath, restoreCurrent)
await commit(subject.restoreCurrent)
await writeFile(longPath, longBaseline)
await commit(subject.longBase)
await writeFile(longPath, longCurrent)
await commit(subject.longCurrent)
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
const sourceLine = text => source.locator('.cm-line').getByText(text, { exact: true })
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const historyEntry = title => history.getByRole('button').filter({ hasText: title })
const hunk = text => review.getByRole('listitem').filter({ hasText: text })
const historySource = (card, label) => card.getByLabel(label, { exact: true })

async function documentAction(name) {
  await button('文档与视图').click()
  await button(name, page.locator('.tool-menu-list')).click()
}

async function appendToSource(line) {
  await source.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText(line)
  await page.keyboard.press('Enter')
}

async function assertSource(expected) {
  try {
    await page.waitForFunction(text => [...document.querySelectorAll('[aria-label="Markdown 源码"] .cm-line')]
      .map(line => line.textContent).join('\n') === text, expected, { timeout: 5000 })
  } catch (error) {
    const actual = (await source.locator('.cm-line').allTextContents()).join('\n')
    if (actual !== expected) assert.equal(actual, expected)
    throw error
  }
}

async function saveAndReopenRestore(expected) {
  await documentAction('保存')
  await tab(restoreNote).getByTitle('有未保存的改动', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await readFile(restorePath, 'utf8'), expected)
  await button('关闭 ' + restoreNote).click()
  await tab(restoreNote).waitFor({ state: 'hidden' })
  await row(restoreNote).click()
  await tab(restoreNote).and(selectedTab).waitFor()
  await assertSource(expected)
}

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
  await appendToSource(draftLine)
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
  await documentAction('打开文件')
  await openHistory(tab(path.basename(outside)), path.basename(outside))
  await history.getByText('当前文档不在 Git 工作区中。', { exact: true }).waitFor()
  await button('关闭', history).click()
  assert.equal(await gitRun('rev-parse', 'HEAD'), head)
  assert.equal(await gitRun('status', '--porcelain=v1'), diskStatus)
  assert.equal(await gitRun('ls-files', '--stage', '-z'), stagedEntries)
  assert.equal(await readFile(path.join(repo, note), 'utf8'), currentText)
  console.log('Keyboard history targets an unopened background document, handles untracked and non-repository documents, and leaves HEAD and working-tree files intact.')

  await row(restoreNote).click()
  await tab(restoreNote).and(selectedTab).waitFor()
  await sourceLine(latestTimeline).waitFor()
  await appendToSource(selectiveDraft.trim())
  await assertSource(restoreCurrent + selectiveDraft)
  await openHistory(tab(restoreNote), restoreNote)
  await assertComparison(subject.restoreBase, oldScope, latestScope)

  const baselineScope = historySource(hunk(oldScope), 'Git 基线')
  const draftScope = historySource(hunk(oldScope), '当前稿')
  assert.equal(await baselineScope.textContent(), oldScope + '\n')
  assert.equal(await draftScope.textContent(), latestScope + '\n')
  const removed = baselineScope.locator('del.review-inline-change')
  const inserted = draftScope.locator('ins.review-inline-change')
  assert.deepEqual(await removed.allTextContents(), ['与导出'])
  assert.deepEqual(await inserted.allTextContents(), ['只'])
  for (const mark of [removed, inserted]) {
    assert.equal(await mark.isVisible(), true)
    assert.notEqual(await mark.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)')
  }

  const deletedHunk = hunk(removedLine)
  assert.equal(await historySource(deletedHunk, 'Git 基线').textContent(), removedLine + '\n')
  assert.equal((await deletedHunk.locator('del.review-inline-change').allTextContents()).join('').trim(), removedLine)
  assert.equal(await deletedHunk.locator('ins.review-inline-change').count(), 0)
  await deletedHunk.getByText('空白', { exact: true }).waitFor()

  const addedHunk = hunk(selectiveDraft.trim())
  assert.equal(await historySource(addedHunk, '当前稿').textContent(), selectiveDraft)
  assert.equal((await addedHunk.locator('ins.review-inline-change').allTextContents()).join('').trim(), selectiveDraft.trim())
  assert.equal(await addedHunk.locator('del.review-inline-change').count(), 0)
  await addedHunk.getByText('空白', { exact: true }).waitFor()
  console.log('History source marks only changed characters within a line and marks all text in removed and unsaved added lines without rewriting source.')

  const hunkChoice = text => hunk(text).getByRole('checkbox', { name: /^恢复第 \d+ 行的改动$/ })
  const hunkChoices = review.getByRole('checkbox', { name: /^恢复第 \d+ 行的改动$/ })
  const selectedHunks = review.getByRole('checkbox', { name: /^恢复第 \d+ 行的改动$/, checked: true })
  const applySelection = button('恢复所选改动', review)
  assert.equal(await hunkChoices.count(), 7)
  assert.equal(await selectedHunks.count(), 0)
  assert.equal(await applySelection.isDisabled(), true)
  const unsavedHunk = hunkChoice(selectiveDraft.trim())
  await unsavedHunk.check()
  await applySelection.click()
  const confirmSelection = page.getByRole('dialog', { name: '恢复所选改动？', exact: true })
  await confirmSelection.getByText('所选改动包含未保存的修改，恢复会覆盖这些修改。', { exact: true }).waitFor()
  assert.equal(await button('取消', confirmSelection).evaluate(element => element === document.activeElement), true)
  await button('取消', confirmSelection).click()
  await confirmSelection.waitFor({ state: 'hidden' })
  assert.equal(await unsavedHunk.isChecked(), true)
  assert.equal(await readFile(restorePath, 'utf8'), restoreCurrent)
  await unsavedHunk.uncheck()
  await hunkChoice(oldScope).check()
  assert.equal(await selectedHunks.count(), 1)
  const diffScreenshot = process.env.SUJIAN_GIT_DIFF_SCREENSHOT || process.env.SUJIAN_GIT_RESTORE_SCREENSHOT
  if (diffScreenshot) {
    await review.screenshot({ path: diffScreenshot })
  }

  await button('排版预览', review).click()
  const preview = review.getByRole('checkbox', { name: '只预览选中的恢复', exact: true })
  assert.equal(await preview.isChecked(), false)
  const baselinePane = review.getByRole('region', { name: 'Git 基线', exact: true })
  const draftPane = review.getByRole('region', { name: '当前稿', exact: true })
  const previewDeleted = 'del.review-rendered-change'
  const previewInserted = 'ins.review-rendered-change'
  const renderedCases = [
    { pane: baselinePane, mark: previewDeleted, scope: oldScope, scopeChange: '与导出', bold: '试用指南', boldChange: '试用',
      link: '报名入口', linkChange: '报名', item: oldListItem, itemChange: '现场', cell: '每周', cellChange: '周' },
    { pane: draftPane, mark: previewInserted, scope: latestScope, scopeChange: '只', bold: '发布指南', boldChange: '发布',
      link: '反馈入口', linkChange: '反馈', item: latestListItem, itemChange: '线上', cell: '每天', cellChange: '天' },
  ]
  for (const { pane, mark, scope, scopeChange, bold, boldChange, link, linkChange, item, itemChange, cell, cellChange } of renderedCases) {
    await pane.getByRole('heading', { name: '发布说明', exact: true }).waitFor()
    const scopeParagraph = pane.locator('p').filter({ hasText: scope })
    const strong = pane.locator('strong').filter({ hasText: bold })
    const anchor = pane.locator('a').filter({ hasText: link })
    const listItem = pane.locator('ul').getByRole('listitem').filter({ hasText: item })
    const table = pane.getByRole('table')
    await table.getByRole('columnheader', { name: '频率', exact: true }).waitFor()
    const tableCell = table.locator('td').filter({ hasText: cell })
    assert.equal(await anchor.textContent(), link)
    assert.equal(await anchor.getAttribute('href'), null)
    for (const [element, change] of [[scopeParagraph, scopeChange], [strong, boldChange], [anchor, linkChange],
      [listItem, itemChange], [tableCell, cellChange]]) {
      await element.locator(mark).filter({ hasText: change }).waitFor()
      assert.deepEqual(await element.locator(mark).allTextContents(), [change])
      assert.equal(await element.locator(mark).isVisible(), true)
    }
    const unchanged = pane.getByText(unchangedGuide, { exact: true })
    await unchanged.waitFor()
    assert.equal(await unchanged.locator(mark).count(), 0)
  }
  const renderedRemovedItem = baselinePane.locator('ul').getByRole('listitem').filter({ hasText: removedLine.slice(2) })
  assert.equal((await renderedRemovedItem.locator(previewDeleted).allTextContents()).join('').trim(), removedLine.slice(2))
  await draftPane.locator(previewInserted).filter({ hasText: selectiveDraft.trim() }).waitFor()
  if (process.env.SUJIAN_GIT_RENDERED_DIFF_SCREENSHOT) {
    await review.screenshot({ path: process.env.SUJIAN_GIT_RENDERED_DIFF_SCREENSHOT })
  }

  await preview.check()
  const restored = review.getByRole('region', { name: '恢复后的文档', exact: true })
  const restoredScope = restored.locator('p').filter({ hasText: oldScope })
  await restoredScope.waitFor()
  assert.equal(await restoredScope.locator(previewInserted).count(), 0)
  await baselinePane.locator('p').filter({ hasText: oldScope }).locator(previewDeleted).waitFor({ state: 'hidden' })
  await restored.locator('td').filter({ hasText: '每天' }).locator(previewInserted).filter({ hasText: '天' }).waitFor()
  await restored.getByText(latestTimeline, { exact: true }).waitFor()
  await restored.getByText(selectiveDraft.trim(), { exact: true }).waitFor()
  assert.equal(await restored.getByText(removedLine.slice(2), { exact: true }).count(), 0)
  await preview.uncheck()
  await draftPane.locator('p').filter({ hasText: latestScope }).locator(previewInserted).filter({ hasText: '只' }).waitFor()
  console.log('Rendered Git differences preserve headings, paragraphs, bold, links, lists and table cells, and omit reverted fragments from the selected-restoration preview.')
  await applySelection.click()
  await review.waitFor({ state: 'hidden' })
  await assertSource(selectivelyRestored)
  assert.equal(await readFile(restorePath, 'utf8'), restoreCurrent)
  await documentAction('撤销本次审阅')
  await assertSource(restoreCurrent + selectiveDraft)
  assert.equal(await readFile(restorePath, 'utf8'), restoreCurrent)

  await openHistory(row(restoreNote), restoreNote, true)
  await assertComparison(subject.restoreBase, oldScope, latestScope, true)
  await hunkChoice(oldScope).check()
  await applySelection.click()
  await review.waitFor({ state: 'hidden' })
  await assertSource(selectivelyRestored)
  await saveAndReopenRestore(selectivelyRestored)
  console.log('Selected Git restoration previews and restores just the checked hunk, preserves unrelated committed and unsaved edits, supports undo, and survives save and reopen.')

  await appendToSource(fullDraft.trim())
  await assertSource(selectivelyRestored + fullDraft)
  await openHistory(tab(restoreNote), restoreNote)
  await assertComparison(subject.restoreBase, oldTimeline, latestTimeline)
  const confirmFull = page.getByRole('dialog', { name: '恢复整个历史版本？', exact: true })
  const requestFull = button('恢复整篇…', review)
  await hunkChoice(oldTimeline).check()
  await requestFull.click()
  await confirmFull.getByText('当前稿有未保存的修改，整篇恢复会覆盖这些修改。', { exact: true }).waitFor()
  assert.equal(await button('取消', confirmFull).evaluate(element => element === document.activeElement), true)
  if (process.env.SUJIAN_GIT_RESTORE_CONFIRM_SCREENSHOT) {
    await confirmFull.screenshot({ path: process.env.SUJIAN_GIT_RESTORE_CONFIRM_SCREENSHOT })
  }
  await button('取消', confirmFull).click()
  await confirmFull.waitFor({ state: 'hidden' })
  await review.getByLabel('当前稿', { exact: true }).filter({ hasText: fullDraft.trim() }).waitFor()
  assert.equal(await hunkChoice(oldTimeline).isChecked(), true)
  assert.equal(await readFile(restorePath, 'utf8'), selectivelyRestored)

  await requestFull.click()
  await button('确认恢复整篇', confirmFull).click()
  await review.waitFor({ state: 'hidden' })
  await assertSource(restoreBaseline)
  assert.equal(await readFile(restorePath, 'utf8'), selectivelyRestored)
  await tab(restoreNote).click({ button: 'right' })
  const restoreTabMenu = page.getByRole('menu', { name: '操作 ' + restoreNote })
  await restoreTabMenu.getByRole('menuitem', { name: '撤销本次审阅', exact: true }).click()
  await assertSource(selectivelyRestored + fullDraft)
  assert.equal(await readFile(restorePath, 'utf8'), selectivelyRestored)

  await openHistory(tab(restoreNote), restoreNote)
  await assertComparison(subject.restoreBase, oldTimeline, latestTimeline)
  await requestFull.click()
  await button('确认恢复整篇', confirmFull).click()
  await review.waitFor({ state: 'hidden' })
  await assertSource(restoreBaseline)
  await saveAndReopenRestore(restoreBaseline)
  assert.equal(await gitRun('rev-parse', 'HEAD'), head)
  assert.equal(await gitRun('ls-files', '--stage', '-z'), stagedEntries)
  console.log('Full Git restoration warns about unsaved changes, preserves checked hunks on cancel, and can be undone or saved without changing Git HEAD/index.')

  await openHistory(tab(restoreNote), restoreNote)
  await assertComparison(subject.restoreCurrent, latestScope, oldScope)
  await hunkChoice(oldScope).check()
  await requestFull.click()
  const confirmRestore = button('确认恢复整篇', confirmFull)
  await confirmRestore.waitFor()
  assert.equal(await confirmRestore.isEnabled(), true)
  const externalScope = '外部编辑器已更新试用范围。'
  const externalText = restoreBaseline.replace(oldScope, externalScope)
  await writeFile(restorePath, externalText)
  await confirmFull.getByText('当前稿已改变。请取消并重新核对差异。', { exact: true }).waitFor()
  assert.equal(await confirmRestore.isDisabled(), true)
  await button('取消', confirmFull).click()
  await review.getByLabel('当前稿', { exact: true }).filter({ hasText: externalScope }).waitFor()
  assert.equal(await selectedHunks.count(), 0)
  assert.equal(await applySelection.isDisabled(), true)
  await button('结束审阅', review).click()
  await assertSource(externalText)
  assert.equal(await readFile(restorePath, 'utf8'), externalText)
  console.log('An external file edit invalidates open full-restore confirmation and clears stale hunk selections.')

  await openHistory(row(longNote), longNote, true)
  await assertComparison(subject.longBase, '交接日期定在周三。', '交接日期定在周五。', true)
  await button('排版预览', review).click()
  for (const { pane, mark, changes } of [
    { pane: baselinePane, mark: previewDeleted, changes: ['三', '测试', '待'] },
    { pane: draftPane, mark: previewInserted, changes: ['五', '归档', '已'] },
  ]) {
    await pane.locator('td ' + mark).filter({ hasText: changes[2] }).waitFor()
    assert.equal(await pane.locator('p').filter({ hasText: '交接日期定在' }).locator(mark).textContent(), changes[0])
    assert.equal(await pane.locator('li ' + mark).textContent(), changes[1])
    assert.deepEqual(await pane.locator(mark).allTextContents(), changes)
    await pane.getByText(longParagraph(360), { exact: true }).waitFor()
  }
  await button('结束审阅', review).click()
  await tab(restoreNote).and(selectedTab).waitFor()
  assert.equal(await readFile(longPath, 'utf8'), longCurrent)
  console.log('Rendered Git highlights remain precise after 720 unchanged paragraphs and preserve the active document.')
} catch (error) {
  const alerts = await page.getByRole('alert').allTextContents()
  if (alerts.length) console.error('Desktop error:', alerts.join('\n'))
  throw error
} finally {
  await app.close()
}

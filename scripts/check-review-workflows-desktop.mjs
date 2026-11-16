import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { _electron } from 'playwright'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const { version, homepage } = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-review-'))
const repo = path.join(working, 'workspace')
const records = path.join(repo, 'records')
const target = path.join(repo, 'requirements.md')
const evidence = path.join(records, '验证 记录.md')
const baselineFile = path.join(working, '旧底稿.md')
const candidateFile = path.join(working, '候选修订.md')
const gitCurrentLine = '桌面安装包使用 `prod` 通道。'
const gitHeadLine = '桌面安装包使用 `beta` 通道！'
const gitTagLine = '桌面安装包使用 `test` 通道？'
const original = [
  '# 审阅样例', '', '需要修订的第一段。', '', gitCurrentLine, '',
  '稳定段落乙。', '', '稳定段落丙。', '', '需要保留的末段。', '',
].join('\n')
const candidate = original.replace('需要修订的第一段。', '采纳这一段新说明。').replace('需要保留的末段。', '跳过这一段新说明。')
const olderBaseline = original.replace('需要修订的第一段。', '三方审阅的旧说明。')
const importedCandidate = olderBaseline.replace('三方审阅的旧说明。', '候选稿的冲突说明。').replace('需要保留的末段。', '独立的候选改动。')
const executablePath = process.env.SUJIAN_QA_EXE
const args = [`--user-data-dir=${path.join(working, 'profile')}`]
if (!executablePath) args.push(project)
const git = (...arguments_) => promisify(execFile)('git', ['-C', repo, ...arguments_])

await mkdir(records, { recursive: true })
await Promise.all([
  writeFile(target, original.replace(gitCurrentLine, gitTagLine)),
  writeFile(evidence, '# 验证记录\n\n第三行证据。\n'),
  writeFile(baselineFile, Buffer.from('\ufeff' + olderBaseline.replaceAll('\n', '\r\n'), 'utf16le')),
  writeFile(candidateFile, importedCandidate.replaceAll('\n', '\r\n')),
])
await git('init', '-q')
await git('add', 'requirements.md')
await git('-c', 'user.name=Sujian QA', '-c', 'user.email=sujian-qa@example.invalid', 'commit', '-qm', 'Review baseline')
await git('-c', 'tag.gpgSign=false', 'tag', 'review-base')
await writeFile(target, original.replace(gitCurrentLine, gitHeadLine))
await git('add', 'requirements.md')
await git('-c', 'user.name=Sujian QA', '-c', 'user.email=sujian-qa@example.invalid', 'commit', '-qm', 'Update review baseline')
await writeFile(target, original)

const app = await _electron.launch({ args: [...args, target, evidence], ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(10000)
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const dialog = name => page.getByRole('dialog', { name, exact: true })
const tab = name => page.getByRole('tab').filter({ hasText: name })
const selectedTab = () => page.getByRole('tab', { selected: true })
const source = page.getByLabel('Markdown 源码')
const sourceLine = text => source.locator('.cm-line').getByText(text, { exact: true })
const review = dialog('审阅修订稿')

async function assertAboutVersion() {
  assert.equal(await app.evaluate(({ app: nativeApp }) => nativeApp.getVersion()), version)
  assert.equal(await page.evaluate(() => window.sujian.appVersion()), version)
  const displayVersion = 'v' + version
  const versionButton = button('关于素笺，当前版本 ' + displayVersion, page.locator('.statusbar'))
  const about = dialog('关于素笺')
  await versionButton.waitFor()
  assert.equal((await versionButton.textContent()).trim(), displayVersion)
  await versionButton.click()
  await about.getByText('当前版本', { exact: true }).waitFor()
  await about.getByText(displayVersion, { exact: true }).waitFor()
  if (process.env.SUJIAN_ABOUT_SCREENSHOT) await about.screenshot({ path: process.env.SUJIAN_ABOUT_SCREENSHOT })
  await page.keyboard.press('Escape')
  await about.waitFor({ state: 'hidden' })

  await versionButton.press('Enter')
  const external = await app.evaluateHandle(({ shell }) => {
    const openExternal = shell.openExternal
    const addresses = []
    let timeout
    const openedAddresses = new Promise(resolve => {
      timeout = setTimeout(() => resolve(addresses), 10_000)
      timeout.unref()
      shell.openExternal = async address => {
        addresses.push(address)
        if (addresses.length === 2) resolve(addresses)
      }
    })
    return {
      openedAddresses,
      restore() {
        clearTimeout(timeout)
        shell.openExternal = openExternal
      },
    }
  })
  try {
    await button('查看发布记录', about).click()
    await button('在 GitHub 上点星', about).press('Enter')
    assert.deepEqual(await external.evaluate(capture => capture.openedAddresses), [homepage + '/releases', homepage])
  } finally {
    await external.evaluate(capture => capture.restore())
    await external.dispose()
  }
  await button('关闭', about).click()
  await about.waitFor({ state: 'hidden' })
  console.log('About shows the running version and opens release history and the GitHub repository through the desktop link handler.')
}

async function documentAction(name) {
  await button('文档与视图').click()
  await button(name, page.locator('.tool-menu-list')).click()
}

async function tabAction(document, action) {
  await tab(document).click({ button: 'right' })
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

async function assertGitInlineDiff(baselineLine, baselineChanges) {
  const baseline = review.getByLabel('Git 基线', { exact: true }).filter({ hasText: baselineLine })
  const current = review.getByLabel('当前稿', { exact: true }).filter({ hasText: gitCurrentLine })
  await baseline.waitFor()
  await current.waitFor()
  assert.equal(await baseline.textContent(), baselineLine + '\n')
  assert.equal(await current.textContent(), gitCurrentLine + '\n')
  assert.deepEqual(await baseline.locator('del.review-inline-change').allTextContents(), baselineChanges)
  assert.deepEqual(await current.locator('ins.review-inline-change').allTextContents(), ['prod', '。'])
}

async function assertGitRenderedDiff(baselineChanges) {
  await button('排版预览', review).click()
  const baseline = review.getByRole('region', { name: 'Git 基线', exact: true })
  const current = review.getByRole('region', { name: '当前稿', exact: true })
  await baseline.locator('code del.review-rendered-change').filter({ hasText: baselineChanges[0] }).waitFor()
  await current.locator('code ins.review-rendered-change').filter({ hasText: 'prod' }).waitFor()
  assert.deepEqual(await baseline.locator('del.review-rendered-change').allTextContents(), baselineChanges)
  assert.deepEqual(await current.locator('ins.review-rendered-change').allTextContents(), ['prod', '。'])
  assert.equal(await baseline.locator('.review-inline-change').count(), 0)
  assert.equal(await current.locator('.review-inline-change').count(), 0)
}

async function openFileComparison() {
  await documentAction('审阅修订稿')
  await button('选择旧底稿', review).click()
  await review.getByText('底稿 · 旧底稿.md', { exact: true }).waitFor()
  await button('选择修订文件', review).click()
  await review.getByText('候选修订.md', { exact: true }).waitFor()
}

try {
  await page.waitForSelector('.application[data-ready="true"]')
  await assertAboutVersion()
  await tab('验证 记录.md').click()
  await tabAction('requirements.md', '审阅修订稿')
  await review.waitFor()
  assert.equal(await tab('验证 记录.md').and(selectedTab()).count(), 1)
  await review.getByLabel('粘贴完整的 Markdown 修订稿').fill(candidate)
  await button('比较修订稿', review).click()
  const changes = review.getByRole('list', { name: '文档改动' })
  await button('采纳此处', changes.getByRole('listitem').filter({ hasText: '采纳这一段新说明。' })).click()
  await button('跳过此处', changes.getByRole('listitem').filter({ hasText: '跳过这一段新说明。' })).click()
  await review.getByText('已采纳 1 · 已跳过 1', { exact: true }).waitFor()
  await button('排版预览', review).click()
  await review.getByLabel('只预览已采纳的改动').check()
  const accepted = review.getByRole('region', { name: '采纳后的文档' })
  await accepted.getByText('采纳这一段新说明。', { exact: true }).waitFor()
  await accepted.getByText('需要保留的末段。', { exact: true }).waitFor()
  await button('应用已采纳改动', review).click()
  await review.waitFor({ state: 'hidden' })
  await tab('requirements.md').click()
  await button('源码').click()
  await sourceLine('采纳这一段新说明。').waitFor()
  await sourceLine('需要保留的末段。').waitFor()
  assert.equal(await readFile(target, 'utf8'), original)
  await documentAction('撤销本次审阅')
  await sourceLine('需要修订的第一段。').waitFor()

  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async (_window, options) => {
      const file = files[options.title]
      return { canceled: !file, filePaths: file ? [file] : [] }
    }
  }, { '选择旧底稿': baselineFile, '选择修订稿': candidateFile })
  await openFileComparison()
  const conflict = changes.getByRole('listitem').filter({ hasText: '内容冲突' })
  await conflict.getByLabel('底稿', { exact: true }).filter({ hasText: '三方审阅的旧说明。' }).waitFor()
  await conflict.getByLabel('当前稿', { exact: true }).filter({ hasText: '需要修订的第一段。' }).waitFor()
  await conflict.getByLabel('修订稿', { exact: true }).filter({ hasText: '候选稿的冲突说明。' }).waitFor()
  assert.equal(await button('采纳此处', conflict).count(), 0)
  assert.equal(await button('应用已采纳改动', review).isDisabled(), true)
  await button('采纳所有可用改动', review).click()
  await review.getByText('已采纳 1 · 已跳过 0 · 1 处冲突', { exact: true }).waitFor()
  await button('结束审阅', review).click()
  await sourceLine('需要保留的末段。').waitFor()
  assert.equal(await readFile(target, 'utf8'), original)

  await openFileComparison()
  await button('更换修订稿', review).click()
  await review.getByLabel('粘贴完整的 Markdown 修订稿').fill(importedCandidate.replace('候选稿的冲突说明。', '需要修订的第一段。'))
  await button('比较修订稿', review).click()
  await review.getByText('已在当前稿中', { exact: true }).waitFor()
  await button('采纳所有可用改动', review).click()
  await button('应用已采纳改动', review).click()
  await review.waitFor({ state: 'hidden' })
  await sourceLine('需要修订的第一段。').waitFor()
  await sourceLine('独立的候选改动。').waitFor()
  await documentAction('撤销本次审阅')
  await sourceLine('需要保留的末段。').waitFor()

  await documentAction('审阅修订稿')
  await button('Git 比较', review).click()
  await button('比较 Git 版本', review).click()
  await assertGitInlineDiff(gitHeadLine, ['beta', '！'])
  await assertGitRenderedDiff(['beta', '！'])
  await review.getByLabel('Git 版本', { exact: true }).fill('review-base')
  await button('比较 Git 版本', review).click()
  await review.getByText(/^review-base · [a-f0-9]{8}$/).waitFor()
  await assertGitInlineDiff(gitTagLine, ['test', '？'])
  await assertGitRenderedDiff(['test', '？'])
  assert.equal(await button('应用已采纳改动', review).count(), 0)
  await button('结束审阅', review).click()
  assert.equal(await readFile(target, 'utf8'), original)
  assert.match((await git('status', '--short', '--', 'requirements.md')).stdout, /^ M requirements\.md/m)

  await source.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
  await documentAction('插入来源链接')
  const sourceDialog = dialog('插入来源链接')
  await sourceDialog.getByLabel('来源行号').fill('99')
  assert.equal(await button('插入来源', sourceDialog).isDisabled(), true)
  await sourceDialog.getByLabel('来源行号').fill('3')
  await sourceDialog.getByLabel('链接文字').fill('验证证据')
  await button('插入来源', sourceDialog).click()
  const link = '[验证证据](records/%E9%AA%8C%E8%AF%81%20%E8%AE%B0%E5%BD%95.md#L3)'
  await page.waitForFunction(markdown => document.querySelector('.cm-content')?.textContent.includes(markdown), link)
  await documentAction('保存')
  await page.waitForFunction(async ({ target, link }) => (await window.sujian.openPath(target)).text.includes(link), { target, link })
  await documentAction('阅读模式')
  await page.getByRole('link', { name: '验证证据', exact: true }).click()
  await tab('验证 记录.md').and(selectedTab()).waitFor()
  await source.locator('.cm-activeLine').getByText('第三行证据。', { exact: true }).waitFor()

  await documentAction('从模板创建文档')
  await button('创建规格与验收', dialog('从模板创建文档')).click()
  await Promise.all(['spec.md', 'plan.md', 'tasks.md'].map(name => tab(name).waitFor()))
  await tab('spec.md').click()
  await documentAction('检查规格与验收')
  const check = dialog('检查规格与验收')
  const issue = check.getByRole('button', { name: /TASK-001 缺少测试证据链接/ })
  await issue.click()
  await tab('tasks.md').and(selectedTab()).waitFor()
  await source.locator('.cm-activeLine').getByText('## TASK-001 实现与验证', { exact: true }).waitFor()
  console.log('Desktop review verified file/old baseline loading, three-way conflict and cancellation, resolved apply/undo, Git HEAD/tag word and punctuation highlights, source links, templates and spec navigation.')
} finally {
  await app.close()
}

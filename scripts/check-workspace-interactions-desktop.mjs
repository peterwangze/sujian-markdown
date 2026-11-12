import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { waitForCheck } from './desktop-checks.mjs'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-workspace-'))
const profile = path.join(working, 'profile')
const root = path.join(working, '项目')
const main = path.join(root, '正文.md')
const second = path.join(root, '来源.md')
const copy = path.join(root, '冲突副本.md')
const savedAs = path.join(root, '另存版本.md')
const original = '# 正文\n\nalpha ALPHA alphabetical\n\n## 子章节\n\nalpha\n'
await Promise.all([mkdir(profile), mkdir(root)])
await Promise.all([
  writeFile(main, original),
  writeFile(second, '# 来源\n\n定位交付编号 42。\n'),
  writeFile(path.join(profile, 'preferences.json'), JSON.stringify({ mode: 'source' })),
])

const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + profile]
if (!executablePath) args.push(project)
let app, page
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const modal = name => page.getByRole('dialog', { name, exact: true })
const tab = name => page.getByRole('tab', { name, exact: true })
const source = () => page.getByLabel('Markdown 源码')
const tree = name => page.locator('[data-sidebar-row]').getByText(name, { exact: true }).first()
const saved = () => page.getByRole('contentinfo').getByText('已保存', { exact: true }).waitFor()

async function launch(...paths) {
  app = await _electron.launch({ args: [...args, ...paths], ...(executablePath && { executablePath }) })
  page = await app.firstWindow()
  page.setDefaultTimeout(12000)
  await page.waitForSelector('.application[data-ready="true"]')
}

async function action(name) {
  await button('文档与视图').click()
  await button(name, page.locator('.tool-menu-list')).click()
}

async function context(row, name) {
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name, exact: true }).click()
}

async function pathAction(row, name, value) {
  await context(row, name === '移动到文件夹' ? '移动到…' : name)
  const dialog = modal(name)
  await dialog.getByRole('textbox').fill(value)
  await button('确定', dialog).click()
  await dialog.waitFor({ state: 'hidden' })
}

async function mockSave(filePath) {
  await app.evaluate(({ dialog }, destination) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination })
  }, filePath)
}

async function waitForDraft(name, text) {
  await waitForCheck(`Expected to persist recovery draft ${name}`, () => page.evaluate(async ({ name, text }) =>
    (await window.sujian.loadDrafts()).some(draft => draft.name === name && draft.text.includes(text)), { name, text }))
}

try {
  await launch(main)
  await source().getByText('alpha ALPHA alphabetical', { exact: true }).waitFor()
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
  }, root)
  await action('打开文件夹')
  await tree('来源.md').waitFor()
  await button('大纲').click()
  await button('折叠小节').click()
  await button('子章节').waitFor({ state: 'hidden' })
  await button('展开小节').click()
  await button('子章节').click()
  await page.waitForFunction(() => document.querySelector('.cm-activeLine')?.textContent === '## 子章节')
  await button('文件').click()

  await page.locator('.work-area').evaluate(area => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['# 拖入文档\n'], '拖入文档.md', { type: 'text/markdown' }))
    transfer.items.add(new File(['ignored'], '忽略.zip', { type: 'application/zip' }))
    area.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  })
  await tab('拖入文档.md').waitFor()
  await source().getByText('# 拖入文档', { exact: true }).waitFor()
  assert.equal(await tab('忽略.zip').count(), 0)
  await tab('正文.md').click()

  await button('切换文件列表').click()
  await tree('来源.md').waitFor()
  await button('切换按名称或修改时间排序').click()
  await waitForCheck('Expected sort preference to persist', () =>
    page.evaluate(async () => (await window.sujian.loadPreferences()).fileSort === 'recent'))
  await button('切换文件树').click()
  await context(tree('项目'), '固定文件夹')
  await page.getByRole('heading', { name: '固定文件夹' }).waitFor()

  await button('在工作区内搜索').click()
  const search = modal('搜索工作区')
  const query = search.getByRole('textbox', { name: '工作区搜索文字' })
  await search.getByRole('checkbox', { name: '正则表达式' }).check()
  await query.fill('交付编号 [0-9]+')
  await query.press('Enter')
  await search.getByText('1 处匹配', { exact: true }).waitFor()
  await search.getByRole('button', { name: /来源\.md · 第 3 行/ }).click()
  await search.waitFor({ state: 'hidden' })
  assert.equal(await tab('来源.md').getAttribute('aria-selected'), 'true')
  await page.waitForFunction(() => document.querySelector('.cm-activeLine')?.textContent === '定位交付编号 42。')
  await tab('正文.md').click()

  await button('查找').click()
  const find = page.getByRole('region', { name: '查找和替换' })
  const findText = find.getByRole('textbox', { name: '查找文字' })
  const regex = find.getByRole('checkbox', { name: '正则表达式' })
  await regex.check()
  await findText.fill('[')
  await findText.press('Enter')
  await find.getByText(/regular expression|unterminated|正则/i).waitFor()
  await regex.uncheck()
  await find.getByRole('checkbox', { name: '区分大小写' }).check()
  await find.getByRole('checkbox', { name: '全词' }).check()
  await findText.fill('alpha')
  await findText.press('Enter')
  await find.getByText(/^\d \/ 2$/).waitFor()
  await button('替换', find).click()
  await find.getByRole('textbox', { name: '替换为' }).fill('beta')
  await button('替换一处', find).click()
  await find.getByText('已替换 1 处', { exact: true }).waitFor()
  await button('全部替换', find).click()
  await find.getByText('已替换 1 处', { exact: true }).waitFor()
  await button('关闭查找').click()
  await action('保存')
  await saved()
  assert.equal(await readFile(main, 'utf8'), original.replaceAll(/\balpha\b/g, 'beta'))

  await pathAction(tree('项目'), '新建子文件夹', '归档')
  const archive = path.join(root, '归档')
  await tree('归档').waitFor()
  await pathAction(tree('来源.md'), '重命名', '已重命名.md')
  const renamed = path.join(root, '已重命名.md')
  await tab('已重命名.md').waitFor()
  await assert.rejects(access(second), { code: 'ENOENT' })
  await pathAction(tree('已重命名.md'), '移动到文件夹', archive)
  await tree('归档').click()
  await tree('已重命名.md').waitFor()
  await assert.rejects(access(renamed), { code: 'ENOENT' })
  const moved = path.join(archive, '已重命名.md')
  assert.match(await readFile(moved, 'utf8'), /交付编号 42/)
  await context(tree('已重命名.md'), '复制')
  const duplicate = path.join(archive, '已重命名 - 副本.md')
  await tree('已重命名 - 副本.md').waitFor()
  assert.equal(await readFile(duplicate, 'utf8'), await readFile(moved, 'utf8'))
  await context(tree('已重命名 - 副本.md'), '撤销文件操作')
  await tree('已重命名 - 副本.md').waitFor({ state: 'hidden' })
  await assert.rejects(access(duplicate), { code: 'ENOENT' })
  await context(tree('已重命名.md'), '复制')
  await tree('已重命名 - 副本.md').waitFor()
  const trashed = modal('移到回收站？')
  await context(tree('已重命名 - 副本.md'), '移到回收站')
  await button('取消', trashed).click()
  assert.equal(await readFile(duplicate, 'utf8'), await readFile(moved, 'utf8'))
  await context(tree('已重命名 - 副本.md'), '移到回收站')
  await button('移到回收站', trashed).click()
  await trashed.waitFor({ state: 'hidden' })
  await assert.rejects(access(duplicate), { code: 'ENOENT' })
  const pinned = page.locator('.sidebar-section').filter({ has: page.getByRole('heading', { name: '固定文件夹' }) })
  await button('取消固定', pinned).click()
  await pinned.waitFor({ state: 'hidden' })

  await tab('已重命名.md').click()
  await app.evaluate(({ dialog }) => {
    globalThis.workspaceCanceledSave = false
    dialog.showSaveDialog = async () => {
      globalThis.workspaceCanceledSave = true
      return { canceled: true }
    }
  })
  await action('另存为')
  await waitForCheck('Expected the native Save As picker to be canceled', () => app.evaluate(() => globalThis.workspaceCanceledSave))
  assert.equal(await tab('已重命名.md').getAttribute('aria-selected'), 'true')
  await mockSave(savedAs)
  await action('另存为')
  await tab('另存版本.md').waitFor()
  assert.equal(await readFile(savedAs, 'utf8'), await readFile(moved, 'utf8'))
  await tab('正文.md').click()

  await source().press('Control+End')
  await page.keyboard.insertText('\n保留本地编辑\n')
  await writeFile(main, '# 磁盘外部更新\n')
  await button('处理冲突').click()
  const conflict = modal('文件发生冲突')
  await conflict.getByText('# 磁盘外部更新', { exact: true }).waitFor()
  await mockSave(copy)
  await button('另存副本', conflict).click()
  await conflict.waitFor({ state: 'hidden' })
  assert.equal(await readFile(main, 'utf8'), '# 磁盘外部更新\n')
  assert.match(await readFile(copy, 'utf8'), /保留本地编辑/)

  await tree('正文.md').click()
  await source().getByText('# 磁盘外部更新', { exact: true }).waitFor()
  await source().press('Control+End')
  await page.keyboard.insertText('用磁盘版本替换的编辑\n')
  await writeFile(main, '# 磁盘重载版本\n')
  await button('处理冲突').click()
  await button('读取磁盘版本', conflict).click()
  await conflict.waitFor({ state: 'hidden' })
  await source().getByText('# 磁盘重载版本', { exact: true }).waitFor()
  assert.equal(await source().getByText('用磁盘版本替换的编辑', { exact: true }).count(), 0)

  await source().press('Control+End')
  await page.keyboard.insertText('手动确认覆盖\n')
  await writeFile(main, '# 再次发生外部更改\n')
  await button('处理冲突').click()
  await button('覆盖磁盘版本', conflict).click()
  await conflict.waitFor({ state: 'hidden' })
  assert.equal(await readFile(main, 'utf8'), '# 磁盘重载版本\n手动确认覆盖\n')

  await tab('冲突副本.md').click()
  await source().press('Control+End')
  await page.keyboard.insertText('准备删除的恢复记录\n')
  await waitForDraft('冲突副本.md', '准备删除的恢复记录')
  await button('新建文档').click()
  await source().focus()
  await page.keyboard.insertText('断电后恢复的草稿')
  await waitForDraft('未命名.md', '断电后恢复的草稿')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].destroy())
  await app.close()
  app = null
  await launch()
  await page.getByRole('button', { name: /^恢复草稿/ }).click()
  const recovery = modal('恢复草稿')
  const disposable = recovery.locator('.recover-row').filter({ hasText: '冲突副本.md' })
  await button('删除', disposable).click()
  const deletion = modal('删除恢复草稿？')
  await button('取消', deletion).click()
  await button('删除', disposable).click()
  await button('删除草稿', deletion).click()
  await disposable.waitFor({ state: 'hidden' })
  assert.doesNotMatch(await readFile(copy, 'utf8'), /准备删除的恢复记录/)
  await button('恢复', recovery).click()
  await source().getByText('断电后恢复的草稿', { exact: true }).waitFor()
  const unsaved = page.getByRole('tab').filter({ hasText: '未命名.md' })
  await unsaved.press('Delete')
  const close = modal('保存更改？')
  await button('取消', close).click()
  await unsaved.waitFor()
  await unsaved.press('Delete')
  await button('放弃更改', close).click()
  await unsaved.waitFor({ state: 'detached' })
  console.log('Passed desktop navigation/search, file actions, conflict copy/reload/overwrite and crash recovery.')
} finally {
  await app?.close()
}

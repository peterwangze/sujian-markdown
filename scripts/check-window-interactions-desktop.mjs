import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { waitForCheck } from './desktop-checks.mjs'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-window-'))
const file = path.join(working, '窗口文档.md')
await writeFile(file, '# Window QA\n')
const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + path.join(working, 'profile')]
if (!executablePath) args.push(project)
args.push(file)
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(10000)
const mac = process.platform === 'darwin'
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })

async function action(name) {
  await button('文档与视图').click()
  await button(name, page.locator('.tool-menu-list')).click()
}

async function shortcut(keyCode, ...modifiers) {
  await app.evaluate(({ BrowserWindow }, input) => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    window.focus()
    for (const type of ['keyDown', 'keyUp']) window.webContents.sendInputEvent({ type, ...input })
  }, { keyCode, modifiers })
}

function fullScreen(value) {
  return waitForCheck(`Expected fullscreen to be ${value}`, () => app.evaluate(
    ({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].isFullScreen() === value, value))
}

try {
  await page.waitForSelector('.application[data-ready="true"]')
  await page.getByLabel('Markdown 即时编辑').locator('h1').filter({ hasText: 'Window QA' }).waitFor()
  await action('全屏')
  await fullScreen(true)
  await shortcut(mac ? 'F' : 'F11', ...(mac ? ['meta', 'control'] : []))
  await fullScreen(false)

  await button('设置').click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await button('快捷键', settings).click()
  await settings.getByRole('searchbox', { name: '搜索快捷键' }).fill('新建窗口')
  const entry = settings.getByRole('region', { name: '新建窗口', exact: true })
  await button('设置新建窗口快捷键', entry).click()
  await entry.getByRole('textbox', { name: '新建窗口的新快捷键' }).press('Alt+Shift+F6')
  await button('保存', entry).click()
  await button('恢复新建窗口默认快捷键', entry).waitFor()
  await button('关闭', settings).click()
  await waitForCheck('Expected Electron to unregister the old New Window accelerator', () => app.evaluate(({ Menu }) =>
    !Menu.getApplicationMenu().items.find(item => item.label === '文件').submenu.items
      .find(item => item.label === '新建窗口').accelerator))
  const opening = app.waitForEvent('window')
  await page.keyboard.press('Alt+Shift+F6')
  const other = await opening
  await other.waitForSelector('.application[data-ready="true"]')
  assert.equal(app.windows().length, 2)
  assert.equal(await page.getByRole('tab', { name: '窗口文档.md' }).count(), 1)
  await other.close()
  console.log('Passed native fullscreen, new-window shortcut remap, and original window preservation.')
} finally {
  await app.close()
}

import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import { waitForCheck } from './desktop-checks.mjs';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const working = await mkdtemp(path.join(tmpdir(), 'sujian-settings-qa-'));
const profile = path.join(working, 'profile');
const fixture = path.join(working, '设置验收.md');
const hiddenFixture = path.join(working, '.隐藏文档.md');
const imageFile = path.join(working, 'settings-pixel.png');
const fontFile = path.join(working, '验收字体.woff2');
const invalidFont = path.join(working, '损坏字体.woff2');
const css = ':root { --sujian-qa-theme: imported; }';
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n5sAAAAASUVORK5CYII=', 'base64');

await Promise.all([
  writeFile(fixture, '# 设置验收\n\n长行源码 ' + 'Markdown 用于设置验收。'.repeat(30) + '\n\n```js\nconst note = 1;\n```\n'),
  writeFile(hiddenFixture, '# 隐藏文档\n'),
  writeFile(imageFile, imageBytes),
  copyFile(path.join(project, 'public/fonts/JetBrainsMono-Regular.woff2'), fontFile),
  writeFile(invalidFont, 'invalid font'),
]);

const themeChoices = [
  ['暖白', 'paper', 'light', '#faf8f4'], ['亮白', 'light', 'light', '#ffffff'],
  ['羊皮纸', 'sepia', 'light', '#f5ecd9'], ['雾蓝', 'mist', 'light', '#eff4f7'],
  ['深墨', 'dark', 'dark', '#232120'], ['松影', 'forest', 'dark', '#202b28'], ['高对比', 'contrast', 'dark', '#000000'],
];
const fontRoles = ['正文与标题', '源码与代码', '菜单与界面'];
const defaultFonts = ['source-serif', 'jetbrains', 'inter'];
const documentProperties = ['--serif', '--mono', '--sans'];
let app;
let page;
const runtimeErrors = [];
const externalRequests = [];

async function launch(openFixture = true) {
  const executablePath = process.env.SUJIAN_QA_EXE;
  const args = ['--user-data-dir=' + profile];
  if (!executablePath) args.push(project);
  if (openFixture) args.push(fixture);
  app = await _electron.launch({ args, ...(executablePath && { executablePath }) });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
  await page.locator('.application[data-ready="true"]').waitFor();
}

function button(root, name) {
  return root.getByRole('button', { name, exact: true });
}

async function settings(panel) {
  await button(page, '设置').click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await button(dialog, panel).click();
  return dialog;
}

function preference(expected) {
  return waitForCheck('Settings did not persist: ' + Object.keys(expected).join(', '), async () => {
    const saved = await page.evaluate(() => window.sujian.loadPreferences());
    return Object.entries(expected).every(([key, value]) => saved[key] === value);
  });
}

function theme(id, scheme) {
  return page.waitForFunction(({ id, scheme }) => document.documentElement.dataset.theme === id &&
    document.documentElement.dataset.colorScheme === scheme, { id, scheme });
}

async function mockOpenDialog(filePaths) {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: paths.length === 0, filePaths: paths });
  }, filePaths);
}

async function fontProperties(family) {
  await page.waitForFunction(({ properties, family }) => properties.every(property =>
    getComputedStyle(document.documentElement).getPropertyValue(property).includes(family)),
  { properties: documentProperties, family });
}

try {
  await launch();
  await mockOpenDialog([working]);
  await button(page, '打开文件夹').click();
  const treeRows = page.locator('.sidebar-content button[data-level="1"]');
  await button(page, '设置验收.md').and(treeRows).waitFor();
  const hiddenRow = button(page, '.隐藏文档.md').and(treeRows);
  assert.equal(await hiddenRow.count(), 0);
  const files = await settings('文件与资源');
  const hiddenFiles = files.getByRole('checkbox', { name: '显示隐藏文件' });
  await hiddenFiles.check();
  await button(files, '关闭').click();
  await hiddenRow.waitFor();

  let dialog = await settings('外观');
  assert.equal(await dialog.getByRole('group', { name: '主题' }).getByRole('button').count(), 8);
  for (const [label, id, scheme, canvas] of themeChoices) {
    const choice = button(dialog, label);
    await choice.click();
    await theme(id, scheme);
    assert.equal(await choice.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('html').evaluate(root => getComputedStyle(root).getPropertyValue('--canvas').trim()), canvas);
  }
  assert.equal(await page.locator('html').getAttribute('data-contrast'), 'high');
  await button(dialog, '跟随系统').click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await theme('dark', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await theme('paper', 'light');
  await button(dialog, '雾蓝').click();
  await dialog.getByLabel('文档宽度').press('End');
  await dialog.getByText('自定义主题 CSS', { exact: true }).click();
  await dialog.getByLabel('样式表').fill(':root { --sujian-qa-theme: typed; }');
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--sujian-qa-theme').trim() === 'typed');
  await dialog.locator('input[type=file]').setInputFiles({ name: '主题.css', mimeType: 'text/css', buffer: Buffer.from(css) });
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--sujian-qa-theme').trim() === 'imported');
  await preference({ theme: 'mist', width: 1160, customCss: css });

  await button(dialog, '字体').click();
  for (const [index, role] of fontRoles.entries()) {
    const select = dialog.getByLabel(role, { exact: true });
    assert.equal(await select.inputValue(), defaultFonts[index]);
    assert.deepEqual(await select.locator('optgroup[label="内置字体"] option').allTextContents(),
      ['Inter', 'Source Serif 4', 'JetBrains Mono', 'Noto Sans SC', 'Noto Serif SC']);
    await select.selectOption('noto-sans-sc');
  }
  await fontProperties('Noto Sans SC');
  await dialog.getByLabel('正文字号').press('End');
  await dialog.getByLabel('正文行距').press('End');
  await mockOpenDialog([]);
  await button(dialog, '导入字体').click();
  await dialog.getByText('支持 TTF、OTF、WOFF 和 WOFF2。', { exact: true }).waitFor();
  await mockOpenDialog([fontFile, invalidFont]);
  await button(dialog, '导入字体').click();
  const status = dialog.locator('p[role="status"]');
  await status.filter({ hasText: '已导入 1 个字体' }).waitFor();
  assert.match(await status.textContent(), /损坏字体.*字体内容无效/);
  const imported = await page.evaluate(async () => (await window.sujian.listFonts())[0]);
  assert.equal(imported.name, '验收字体');
  const importedValue = 'imported:' + imported.id;
  const importedFamily = 'Sujian Imported ' + imported.id;
  for (const role of fontRoles) await dialog.getByLabel(role, { exact: true }).selectOption(importedValue);
  await fontProperties(importedFamily);
  await page.waitForFunction(family => [...document.fonts].some(face => face.family.includes(family) && face.status === 'loaded'), importedFamily);
  await mockOpenDialog([fontFile]);
  await button(dialog, '导入字体').click();
  await status.filter({ hasText: /已导入|已存在/ }).waitFor();
  assert.equal(await button(dialog, '移除字体 验收字体').count(), 1);

  await button(dialog, '编辑').click();
  await dialog.getByLabel('默认编辑模式').selectOption('source');
  await dialog.getByRole('checkbox', { name: '显示侧栏' }).uncheck();
  await dialog.getByRole('checkbox', { name: '专注模式' }).check();
  await dialog.getByRole('checkbox', { name: '打字机模式' }).check();
  await dialog.getByRole('checkbox', { name: '源码自动换行' }).uncheck();
  await button(dialog, '文件与资源').click();
  const autoSave = dialog.getByRole('checkbox', { name: '自动保存已有文件' });
  assert.equal(await autoSave.isChecked(), false);
  await autoSave.check();
  assert.equal(await dialog.getByRole('checkbox', { name: '恢复上次打开的文档' }).isChecked(), true);
  await dialog.getByRole('checkbox', { name: '显示隐藏文件' }).check();
  await dialog.getByLabel('文档图片目录').fill('attachments');
  await button(dialog, '关闭').click();
  await page.locator('.editor-mode-source.editor-focus-mode.editor-typewriter').waitFor();
  assert.equal(await page.locator('.application').evaluate(root => root.classList.contains('with-sidebar')), false);
  assert.equal(await page.locator('.cm-content').evaluate(root => root.classList.contains('cm-lineWrapping')), false);
  await page.locator('.cm-content').press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  const change = '设置验收自动保存';
  await page.keyboard.insertText('\n' + change + '\n');
  await waitForCheck('Auto-save did not update the document on disk', async () => (await readFile(fixture, 'utf8')).includes(change));
  await mockOpenDialog([imageFile]);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Control+i' : 'Control+Shift+i');
  await waitForCheck('File selection did not reference the original image', async () => (await readFile(fixture, 'utf8')).includes('![图片](settings-pixel.png)'));
  await page.locator('.cm-content').evaluate((editor, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'clipboard.png', { type: 'image/png' }));
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, [...imageBytes]);
  const copiedImage = /attachments\/(clipboard-[\da-f]+\.png)/;
  await waitForCheck('The custom image folder was not used', async () => copiedImage.test(await readFile(fixture, 'utf8')));
  const [, imageName] = copiedImage.exec(await readFile(fixture, 'utf8'));
  assert.deepEqual(await readFile(path.join(working, 'attachments', imageName)), imageBytes);

  const saved = { theme: 'mist', mode: 'source', width: 1160, fontSize: 28, lineHeight: 2.2, customCss: css,
    bodyFont: importedValue, sourceFont: importedValue, uiFont: importedValue, sidebar: false, focusMode: true,
    typewriter: true, wrap: false, autoSave: true, resume: true, showHidden: true, imageFolder: 'attachments' };
  await preference(saved);
  await app.close();
  app = null;
  await launch(false);
  await page.getByRole('tab', { name: '设置验收.md' }).waitFor();
  await page.locator('.cm-content').getByText(change, { exact: true }).waitFor();
  await theme('mist', 'light');
  await page.locator('.editor-mode-source.editor-focus-mode.editor-typewriter').waitFor();
  await preference(saved);
  await fontProperties(importedFamily);
  dialog = await settings('字体');
  for (const role of fontRoles) assert.equal(await dialog.getByLabel(role, { exact: true }).inputValue(), importedValue);
  await button(dialog, '移除字体 验收字体').click();
  await dialog.getByRole('status').filter({ hasText: '已从素笺移除 验收字体' }).waitFor();
  await preference({ bodyFont: defaultFonts[0], sourceFont: defaultFonts[1], uiFont: defaultFonts[2] });
  for (const [index, role] of fontRoles.entries()) {
    assert.equal(await dialog.getByLabel(role, { exact: true }).inputValue(), defaultFonts[index]);
  }
  await page.waitForFunction(family => [...document.fonts].every(face => !face.family.includes(family)), importedFamily);
  await button(dialog, '文件与资源').click();
  await dialog.getByRole('checkbox', { name: '恢复上次打开的文档' }).uncheck();
  await preference({ resume: false });
  await app.close();
  app = null;
  await launch(false);
  await page.getByRole('tab', { name: '写作手册.md' }).waitFor();
  assert.equal(await page.getByRole('tab', { name: '设置验收.md' }).count(), 0);
  assert.deepEqual(runtimeErrors, []);
  assert.deepEqual(externalRequests, []);
  console.log('Themes, custom CSS, fonts, editor preferences, hidden files, custom image path, auto-save and session restore passed.');
} finally {
  await app?.close();
}

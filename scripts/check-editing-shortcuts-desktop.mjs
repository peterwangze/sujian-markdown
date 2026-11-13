import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const working = await mkdtemp(path.join(tmpdir(), 'sujian-editing-qa-'));
const file = path.join(working, '快捷键回归.md');
const secondFile = path.join(working, '原生打开.md');
const imageFile = path.join(working, 'pixel.png');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP/0AAAAASUVORK5CYII=', 'base64');
const mac = process.platform === 'darwin';
const mod = mac ? 'Meta' : 'Control';
const key = (value) => `${mod}+${value}`;
const executablePath = process.env.SUJIAN_QA_EXE;
const args = [`--user-data-dir=${path.join(working, 'profile')}`];
if (!executablePath) args.push(project);

await writeFile(file, [
  '查找重复词 A', '查找重复词 B', '加粗样例', '斜体样例', '下划线样例', '删除线样例', '行内代码样例', '链接样例',
  '围栏样例', '公式样例', '引用样例', '有序样例', '无序样例', '插入表格的位置', '插入图片的位置',
  '任务开始\n\n- [x] Task body', '1. Parent item\n2. Child item',
  '自定义标题', '重置标题', '自定义加粗', '富文本改键样例',
].join('\n\n') + '\n');
await writeFile(secondFile, '# 原生打开\n');
await writeFile(imageFile, image);

let app;
let page;
let source;
let live;
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
const dialog = (name) => page.getByRole('dialog', { name, exact: true });
const tab = (name) => page.getByRole('tab').filter({ hasText: name });
const currentTab = () => tab('快捷键回归.md');
const selectedTab = () => page.getByRole('tab', { selected: true });
const sourceLine = (content) => source.locator('.cm-line').filter({ hasText: content });

async function launch(...documents) {
  app = await _electron.launch({ args: [...args, ...documents], ...(executablePath && { executablePath }) });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.waitForSelector('.application[data-ready="true"]');
  await currentTab().click();
  source = page.getByLabel('Markdown 源码');
  live = page.getByLabel('Markdown 即时编辑');
  await button('源码').click();
  await source.waitFor();
}

async function nativeKey(keyCode, modifiers = [mac ? 'meta' : 'control']) {
  await app.evaluate(({ BrowserWindow }, input) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.focus();
    for (const type of ['keyDown', 'keyUp']) window.webContents.sendInputEvent({ type, ...input });
  }, { keyCode, modifiers });
}

async function selectLine(content) {
  await sourceLine(content).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
}

async function assertLine(content, expected) {
  assert.equal(await sourceLine(content).textContent(), expected);
}

async function copyMarkdown() {
  await app.evaluate(({ clipboard }) => {
    globalThis.copyMarkdownWrite = new Promise((resolve, reject) => {
      const original = clipboard.write;
      clipboard.write = async ([item]) => {
        clipboard.write = original;
        try { resolve(await (await item.getType('text/plain')).text()); } catch (error) { reject(error); }
      };
    });
  });
  await page.keyboard.press(key('Shift+c'));
  return app.evaluate(() => Promise.race([
    globalThis.copyMarkdownWrite,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Copy Markdown did not write to the clipboard')), 5000)),
  ]));
}

async function openSettings() {
  await button('设置').click();
  const settings = dialog('设置');
  await button('快捷键', settings).click();
  return settings;
}

async function shortcutEntry(settings, name) {
  await settings.getByRole('searchbox', { name: '搜索快捷键' }).fill(name);
  return settings.getByRole('region', { name, exact: true });
}

async function assignShortcut(settings, name, shortcut, conflictingShortcut, conflictName) {
  const entry = await shortcutEntry(settings, name);
  await button(`设置${name}快捷键`, entry).click();
  const input = entry.getByRole('textbox', { name: `${name}的新快捷键` });
  if (conflictingShortcut) {
    await input.press(conflictingShortcut);
    assert.equal(await button('保存', entry).isDisabled(), true);
    assert.match(await entry.getByRole('status').textContent(), new RegExp(conflictName));
  }
  await input.press(shortcut);
  await button('保存', entry).click();
  await button(`恢复${name}默认快捷键`, entry).waitFor();
}

try {
  await launch(file);
  await app.evaluate(({ dialog }, { markdown, image }) => {
    dialog.showOpenDialog = async (_window, options) => ({
      canceled: false, filePaths: [options.title === '插入图片' ? image : markdown],
    });
  }, { markdown: secondFile, image: imageFile });
  await nativeKey('O');
  await tab('原生打开.md').and(selectedTab()).waitFor();
  await nativeKey('W');
  await tab('原生打开.md').waitFor({ state: 'detached' });
  await nativeKey('T', [mac ? 'meta' : 'control', 'shift']);
  await tab('原生打开.md').and(selectedTab()).waitFor();
  await page.keyboard.press('Control+Shift+Tab');
  await currentTab().and(selectedTab()).waitFor();

  await nativeKey('F');
  const find = page.getByRole('textbox', { name: '查找文字' });
  await find.fill('查找重复词');
  await find.press('Enter');
  const count = page.locator('.match-count');
  const first = await count.textContent();
  assert.match(first, /^[12] \/ 2$/);
  await find.press('F3');
  assert.notEqual(await count.textContent(), first);
  await find.press('Shift+F3');
  assert.equal(await count.textContent(), first);
  await find.press(key('1'));
  await assertLine('查找重复词 A', '查找重复词 A');
  await assertLine('查找重复词 B', '查找重复词 B');
  await find.press('Escape');

  await sourceLine('Task body').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  assert.equal(await source.locator('.cm-activeLine').textContent(), '- [ ] ');
  await page.keyboard.press('Enter');
  assert.equal(await source.locator('.cm-activeLine').textContent(), '');
  await sourceLine('Child item').click();
  await page.keyboard.press('Tab');
  await assertLine('Child item', '   2. Child item');
  await page.keyboard.press('Shift+Tab');
  await assertLine('Child item', '2. Child item');
  await page.keyboard.press(key('BracketLeft'));
  await assertLine('Child item', '   2. Child item');
  await page.keyboard.press(key('BracketRight'));
  await assertLine('Child item', '2. Child item');

  for (const [content, shortcut, expected] of [
    ['加粗样例', key('b'), '**加粗样例**'],
    ['斜体样例', key('i'), '*斜体样例*'],
    ['下划线样例', key('u'), '<u>下划线样例</u>'],
    ['删除线样例', mac ? 'Control+Shift+Backquote' : 'Alt+Shift+Digit5', '~~删除线样例~~'],
    ['行内代码样例', key('Shift+Backquote'), '`行内代码样例`'],
    ['引用样例', mac ? key('Alt+q') : key('Shift+q'), '> 引用样例'],
    ['有序样例', mac ? key('Alt+o') : key('Shift+BracketLeft'), '1. 有序样例'],
    ['无序样例', mac ? key('Alt+u') : key('Shift+BracketRight'), '- 无序样例'],
  ]) {
    await selectLine(content);
    await page.keyboard.press(shortcut);
    await assertLine(content, expected);
    if (content === '加粗样例') {
      await page.keyboard.press(shortcut);
      await assertLine(content, content);
    }
  }
  await selectLine('围栏样例');
  await page.keyboard.press(mac ? key('Alt+c') : key('Shift+k'));
  await assertLine('围栏样例', '围栏样例');
  assert.equal(await source.locator('.cm-line').getByText('```', { exact: true }).count(), 2);
  await selectLine('公式样例');
  await page.keyboard.press(mac ? key('Alt+b') : key('Shift+m'));
  await assertLine('公式样例', '公式样例');
  assert.equal(await source.locator('.cm-line').getByText('$$', { exact: true }).count(), 2);

  await selectLine('斜体样例');
  assert.equal(await copyMarkdown(), '*斜体样例*');

  await selectLine('链接样例');
  await page.keyboard.press(key('k'));
  const link = dialog('插入链接');
  assert.equal(await link.getByLabel('文字').inputValue(), '链接样例');
  await link.getByLabel('地址').fill('https://example.com/notes');
  await button('插入', link).click();
  await sourceLine('[链接样例](https://example.com/notes)').waitFor();

  await sourceLine('插入图片的位置').click();
  await page.keyboard.press('End');
  await page.keyboard.press(mac ? key('Control+i') : key('Shift+i'));
  await sourceLine('![图片](pixel.png)').waitFor();
  const imageFolder = path.join(working, '快捷键回归.assets');
  await assert.rejects(access(imageFolder), { code: 'ENOENT' });
  assert.deepEqual(await readFile(imageFile), image);

  await sourceLine('插入表格的位置').click();
  await page.keyboard.press('End');
  await page.keyboard.press(mac ? key('Alt+t') : key('t'));
  const table = dialog('插入表格');
  await button('插入', table).click();
  await sourceLine('| 列 1 | 列 2 | 列 3 |').waitFor();
  await button('即时').click();
  const lastCell = live.locator('tbody td').last();
  await lastCell.click();
  const currentCell = () => page.evaluate(() => {
    const anchor = getSelection().anchorNode;
    return (anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement).closest('td, th')?.cellIndex;
  });
  await page.keyboard.press('Tab');
  assert.equal(await live.locator('tbody tr').count(), 3);
  assert.equal(await currentCell(), 0);
  await page.keyboard.press('Tab');
  assert.equal(await currentCell(), 1);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await currentCell(), 0);
  await page.keyboard.insertText('Retained cell');
  await page.keyboard.press(key('Enter'));
  assert.equal(await live.locator('tbody tr').count(), 4);
  await page.keyboard.insertText('Discarded row');
  const tableMenu = page.getByRole('menu');
  const retained = live.getByRole('cell', { name: 'Retained cell', exact: true });
  const discarded = live.getByRole('cell', { name: 'Discarded row', exact: true });
  await discarded.click({ button: 'right' });
  await tableMenu.getByRole('menuitem', { name: '删除行', exact: true }).click();
  assert.equal(await live.locator('tbody tr').count(), 3);
  assert.equal(await discarded.count(), 0);
  await retained.waitFor();
  const removedHeader = live.getByRole('columnheader', { name: '列 3', exact: true });
  await removedHeader.click({ button: 'right' });
  await tableMenu.getByRole('menuitem', { name: '删除列', exact: true }).click();
  assert.deepEqual(await live.locator('table tr').evaluateAll((rows) => rows.map((row) => row.cells.length)), [2, 2, 2, 2]);
  const tableTools = page.getByRole('toolbar', { name: '表格编辑' });
  for (const [heading, tool, alignment] of [['列 1', '左对齐', 'left'], ['列 2', '右对齐', 'right'], ['列 1', '居中', 'center']]) {
    const column = live.getByRole('columnheader', { name: heading, exact: true });
    await column.click();
    await button(tool, tableTools).click();
    assert.equal(await column.getAttribute('align'), alignment);
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  assert.notEqual(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Markdown 即时编辑');
  await button('源码').click();
  await nativeKey('S');
  await currentTab().locator('[title="有未保存的改动"]').waitFor({ state: 'detached' });
  const saved = await readFile(file, 'utf8');
  assert.match(saved, /\[链接样例\]\(https:\/\/example\.com\/notes\)/);
  assert.match(saved, /^\|\s*列 1\s*\|\s*列 2\s*\|\n\|\s*:-+:\s*\|\s*-+:\s*\|$/m);
  assert.match(saved, /^\|\s*Retained cell\s*\|\s*\|$/m);
  assert.doesNotMatch(saved, /Discarded row|列 3/);

  const customHeading = key('Shift+Digit1');
  const customBold = key('Shift+b');
  const customSave = key('Shift+Digit7');
  let settings = await openSettings();
  await assignShortcut(settings, '1 级标题', customHeading, key('2'), '2 级标题');
  await assignShortcut(settings, '加粗', customBold, key('c'), '系统或文本编辑快捷键');
  await assignShortcut(settings, '保存', customSave, 'Control+Tab', '切换到下一个标签');
  await page.keyboard.press('Escape');
  await app.close();
  app = undefined;
  await launch(secondFile, file);
  await source.press(mac ? 'Meta+ArrowDown' : 'Control+End');

  await sourceLine('自定义标题').click();
  await page.keyboard.press(key('1'));
  await assertLine('自定义标题', '自定义标题');
  await page.keyboard.press(customHeading);
  await assertLine('自定义标题', '# 自定义标题');
  await selectLine('自定义加粗');
  await page.keyboard.press(key('b'));
  await assertLine('自定义加粗', '自定义加粗');
  await page.keyboard.press(customBold);
  await assertLine('自定义加粗', '**自定义加粗**');
  await button('即时').click();
  const richSample = live.locator('p').filter({ hasText: '富文本改键样例' });
  await richSample.evaluate((paragraph) => {
    paragraph.closest('[contenteditable]').focus();
    const node = paragraph.firstChild;
    getSelection().setBaseAndExtent(node, 0, node, node.length);
  });
  await page.keyboard.press(key('b'));
  assert.equal(await richSample.locator('strong').count(), 0);
  await page.keyboard.press(customBold);
  const richBold = richSample.locator('strong').getByText('富文本改键样例', { exact: true });
  await richBold.evaluate((element) => getSelection().selectAllChildren(element));
  assert.equal(await copyMarkdown(), '**富文本改键样例**');
  await button('源码').click();
  await nativeKey('S');
  assert.doesNotMatch(await readFile(file, 'utf8'), /\*\*自定义加粗\*\*/);
  await page.keyboard.press(customSave);
  await currentTab().locator('[title="有未保存的改动"]').waitFor({ state: 'detached' });
  assert.match(await readFile(file, 'utf8'), /\*\*自定义加粗\*\*/);
  assert.match(await readFile(file, 'utf8'), /\*\*富文本改键样例\*\*/);

  settings = await openSettings();
  const heading = await shortcutEntry(settings, '1 级标题');
  await button('恢复1 级标题默认快捷键', heading).click();
  const bold = await shortcutEntry(settings, '加粗');
  await button('恢复加粗默认快捷键', bold).click();
  const save = await shortcutEntry(settings, '保存');
  await button('恢复保存默认快捷键', save).click();
  await page.keyboard.press('Escape');
  await sourceLine('重置标题').click();
  await page.keyboard.press(customHeading);
  await assertLine('重置标题', '重置标题');
  await page.keyboard.press(key('1'));
  await assertLine('重置标题', '# 重置标题');
  await nativeKey('S');
  await currentTab().locator('[title="有未保存的改动"]').waitFor({ state: 'detached' });
  assert.match(await readFile(file, 'utf8'), /# 重置标题/);
  await page.keyboard.press('Control+Tab');
  await tab('原生打开.md').and(selectedTab()).waitFor();
  await page.keyboard.press('Control+Shift+Tab');
  await currentTab().and(selectedTab()).waitFor();
  await nativeKey('N');
  await tab('未命名.md').and(selectedTab()).waitFor();
  await button('即时').click();
  await live.click();
  await page.keyboard.press(key('1'));
  await page.keyboard.insertText('新文档首个标题');
  await live.locator('h1').filter({ hasText: '新文档首个标题' }).waitFor();
  console.log('Formatting, editing, table, search and native shortcuts passed. Shortcut recording, conflict detection, restart and reset passed.');
} finally {
  await app?.close();
}

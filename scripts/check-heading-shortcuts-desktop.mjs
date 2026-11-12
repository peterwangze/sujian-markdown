import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const working = await mkdtemp(path.join(tmpdir(), 'sujian-heading-qa-'));
const fixture = path.join(working, '标题快捷键.md');
const other = path.join(working, '另一份笔记.md');
const modes = ['即时', '源码', '分栏预览'];
const levels = [1, 2, 3, 4, 5, 6];
const sample = (mode, level) => `${mode} 标题测试 ${level}`;
const paragraphs = modes.flatMap((mode) => levels.map((level) => sample(mode, level)));
await writeFile(fixture, `${paragraphs.join('\n\n')}\n`);
await writeFile(other, '另一份笔记正文。\n');

const executablePath = process.env.SUJIAN_QA_EXE;
const args = ['--user-data-dir=' + path.join(working, 'profile')];
if (!executablePath) args.push(project);
args.push(other, fixture);
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) });
const page = await app.firstWindow();
page.setDefaultTimeout(10000);

const live = page.getByLabel('Markdown 即时编辑');
const source = page.getByLabel('Markdown 源码');
const currentTab = page.getByRole('tab').filter({ hasText: '标题快捷键.md' });
const otherTab = page.getByRole('tab').filter({ hasText: '另一份笔记.md' });
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const button = (name) => page.getByRole('button', { name, exact: true });

async function documentAction(name) {
  await button('文档与视图').click();
  await page.locator('.tool-menu-list').getByRole('button', { name, exact: true }).click();
}

async function applyHeading(mode, level) {
  const title = sample(mode, level);
  if (mode === '即时') {
    const paragraph = live.locator('p').filter({ hasText: title });
    await paragraph.evaluate((element, selectText) => {
      element.closest('[contenteditable]').focus();
      const text = element.firstChild;
      document.getSelection().setBaseAndExtent(text, 2, text, selectText ? 6 : 2);
    }, level % 2 === 0);
  } else {
    const line = source.locator('.cm-line').filter({ hasText: title });
    await line.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    if (level % 2 === 0) await page.keyboard.press('Shift+ArrowRight');
  }
  await page.keyboard.press(`${modifier}+${level}`);
  if (mode === '即时') {
    await live.locator(`h${level}`).filter({ hasText: title }).waitFor();
  } else {
    const markdown = source.locator('.cm-line').filter({ hasText: title });
    assert.equal(await markdown.textContent(), `${'#'.repeat(level)} ${title}`);
    if (mode === '分栏预览') {
      await page.locator(`.editor-preview h${level}`).getByText(title, { exact: true }).waitFor();
    }
  }
  assert.equal(await currentTab.getAttribute('aria-selected'), 'true');
}

async function clearHeading(mode) {
  const title = sample(mode, 6);
  if (mode === '即时') {
    await live.locator('h6').filter({ hasText: title }).evaluate((element) => {
      element.closest('[contenteditable]').focus();
      document.getSelection().collapse(element, element.childNodes.length);
    });
  } else {
    await source.locator('.cm-line').filter({ hasText: title }).click();
  }
  await page.keyboard.press(`${modifier}+0`);
  if (mode === '即时') {
    await live.locator('p').getByText(title, { exact: true }).waitFor();
  } else {
    assert.equal(await source.locator('.cm-line').filter({ hasText: title }).textContent(), title);
    if (mode === '分栏预览') await page.locator('.editor-preview p').getByText(title, { exact: true }).waitFor();
  }
}

try {
  await live.waitFor();
  await otherTab.waitFor();
  for (const mode of modes) {
    if (mode === '源码') await button(mode).click();
    if (mode === '分栏预览') await documentAction(mode);
    for (const level of levels) await applyHeading(mode, level);
    await clearHeading(mode);
  }

  const title = sample('分栏预览', 1);
  await source.locator('.cm-line').filter({ hasText: title }).click();
  await page.keyboard.press(`${modifier}+3`);
  await page.locator('.editor-preview h3').getByText(title, { exact: true }).waitFor();
  await documentAction('保存');
  const expected = modes.flatMap((mode) => levels.map((level) => {
    if (level === 6) return sample(mode, level);
    const headingLevel = mode === '分栏预览' && level === 1 ? 3 : level;
    return `${'#'.repeat(headingLevel)} ${sample(mode, level)}`;
  })).join('\n\n') + '\n';
  await currentTab.locator('[title="有未保存的改动"]').waitFor({ state: 'detached' });
  assert.equal(await readFile(fixture, 'utf8'), expected);

  await page.keyboard.press('Control+Tab');
  await otherTab.and(page.getByRole('tab', { selected: true })).waitFor();
  await page.keyboard.press('Control+Shift+Tab');
  await currentTab.and(page.getByRole('tab', { selected: true })).waitFor();
  await documentAction('阅读模式');
  await page.locator('.editor-preview').getByText(sample('分栏预览', 6), { exact: true }).click();
  await page.keyboard.press(`${modifier}+1`);
  assert.equal(await currentTab.getAttribute('aria-selected'), 'true');
  await documentAction('保存');
  assert.equal(await readFile(fixture, 'utf8'), expected);

  const zoom = await page.evaluate(() => devicePixelRatio);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomLevel(1));
  await page.waitForFunction((initial) => devicePixelRatio > initial, zoom);
  await page.keyboard.press(`${modifier}+Shift+Digit0`);
  await page.waitForFunction((initial) => devicePixelRatio === initial, zoom);
  console.log('Paragraph and heading shortcuts passed with caret and selection in live, source and split. Tab cycling, read-only mode and zoom reset passed.');
} finally {
  await app.close();
}

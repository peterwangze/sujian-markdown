import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const working = await mkdtemp(path.join(tmpdir(), 'sujian-spellcheck-qa-'));
const fixture = path.join(working, 'technical-notes.md');
const markdown = [
  '---', 'title: frontmattrtypo', '---', '', '# Technical notes', '',
  'Please recieve this message.', '',
  'Use TypeScript, loadClient and parse_value with --dry-run.', '',
  'Run `inlinecodetypo` and keep the <code>htmlcodetypo</code> flag.', '',
  '[Documentation](https://example.org/linkedtypo)', '',
  'Use $formulavariable + 1$ in the calculation.', '',
  '```javascript', 'const fencedcodetypo = 1;', '```', '',
  '    indentedcodetypo()', '', 'End of spelling sample.', '',
].join('\n');
await writeFile(fixture, markdown);

async function launch(profile) {
  const executablePath = process.env.SUJIAN_QA_EXE;
  const args = ['--user-data-dir=' + profile, '--lang=en-US'];
  if (!executablePath) args.push(project);
  args.push(fixture);
  const app = await _electron.launch({ args, ...(executablePath && { executablePath }) });
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  const live = page.getByLabel('Markdown 即时编辑');
  await live.getByText('End of spelling sample.', { exact: true }).waitFor();
  return { app, page, live };
}

function nativeEnabled(app) {
  return app.evaluate(({ session }) => session.defaultSession.isSpellCheckerEnabled());
}

function waitForPreference(page, enabled) {
  return page.waitForFunction(async (expected) => (await window.sujian.loadPreferences()).proseSpellcheck === expected, enabled);
}

async function settings(page, expected, next = expected) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('button', { name: '编辑', exact: true }).click();
  const option = dialog.getByRole('checkbox', { name: '正文拼写检查', exact: true });
  assert.equal(await option.isChecked(), expected);
  if (next !== expected) await option.setChecked(next);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
}

async function verifyWordScope(root, word, expected) {
  const matches = await root.evaluate((editor, word) => {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const values = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.data.includes(word)) values.push(node.parentElement.spellcheck);
    }
    return values;
  }, word);
  assert(matches.length > 0, `${word} is missing from ${await root.getAttribute('aria-label')}`);
  assert(matches.every((enabled) => enabled === expected), `${word} spellcheck scopes: ${matches.join(', ')}`);
}

async function openWordMenu(page, root, word) {
  const point = await root.evaluate((editor, word) => {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const offset = node.data.indexOf(word);
      if (offset < 0 || node.parentElement.closest('.vditor-ir__marker, [contenteditable="false"]')) continue;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + word.length);
      node.parentElement.scrollIntoView({ block: 'nearest' });
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    throw new Error(`No visible occurrence of ${word}`);
  }, word);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  const menu = page.getByRole('menu');
  await menu.waitFor();
  return menu;
}

const fresh = await launch(path.join(working, 'fresh-profile'));
try {
  await waitForPreference(fresh.page, false);
  assert.equal(await nativeEnabled(fresh.app), false);
  await verifyWordScope(fresh.live, 'recieve', false);
  await settings(fresh.page, false);
} finally {
  await fresh.app.close();
}

const legacy = path.join(working, 'legacy-profile');
await mkdir(legacy);
await writeFile(path.join(legacy, 'preferences.json'), JSON.stringify({ spellcheck: true, resume: false }));
const { app, page, live } = await launch(legacy);
try {
  await waitForPreference(page, false);
  assert.equal(await nativeEnabled(app), false);
  await verifyWordScope(live, 'recieve', false);
  const before = await openWordMenu(page, live, 'recieve');
  assert.equal(await before.getByRole('menuitem', { name: '添加到词典', exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  await before.waitFor({ state: 'hidden' });

  if (process.platform !== 'darwin') await app.evaluate(({ session }) => session.defaultSession.setSpellCheckerLanguages(['en-US']));
  await settings(page, false, true);
  await waitForPreference(page, true);
  assert.equal(await nativeEnabled(app), true);
  await page.waitForFunction(() => window.sujian.spellingSuggestions('recieve')?.some((word) => word.toLowerCase() === 'receive'));

  const technical = ['TypeScript', 'loadClient', 'parse_value', 'dry-run', 'inlinecodetypo', 'htmlcodetypo',
    'linkedtypo', 'formulavariable', 'fencedcodetypo', 'indentedcodetypo', 'frontmattrtypo'];
  for (const mode of ['即时', '源码', '分栏预览']) {
    if (mode === '源码') await page.getByRole('button', { name: mode, exact: true }).click();
    if (mode === '分栏预览') {
      await page.getByRole('button', { name: '文档与视图', exact: true }).click();
      await page.locator('.tool-menu-list').getByRole('button', { name: mode, exact: true }).click();
    }
    const editor = mode === '即时' ? live : page.getByLabel('Markdown 源码');
    await editor.waitFor();
    await verifyWordScope(editor, 'recieve', true);
    for (const term of technical) await verifyWordScope(editor, term, false);
    const codeMenu = await openWordMenu(page, editor, 'inlinecodetypo');
    assert.equal(await codeMenu.getByRole('menuitem', { name: '添加到词典', exact: true }).count(), 0);
    await page.keyboard.press('Escape');
    await codeMenu.waitFor({ state: 'hidden' });
    const proseMenu = await openWordMenu(page, editor, 'recieve');
    await proseMenu.getByRole('menuitem', { name: '添加到词典', exact: true }).waitFor();
    const correction = proseMenu.getByRole('menuitem', { name: 'receive', exact: true });
    await correction.waitFor();
    if (mode === '分栏预览') await correction.click();
    else await page.keyboard.press('Escape');
    await proseMenu.waitFor({ state: 'hidden' });
  }
  await page.getByRole('button', { name: '文档与视图', exact: true }).click();
  await page.locator('.tool-menu-list').getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('contentinfo').getByText('已保存', { exact: true }).waitFor();
  assert.equal(await readFile(fixture, 'utf8'), markdown.replace('recieve', 'receive'));
} finally {
  await app.close();
}

const restored = await launch(legacy);
try {
  await waitForPreference(restored.page, true);
  assert.equal(await nativeEnabled(restored.app), true);
  await settings(restored.page, true, false);
  await waitForPreference(restored.page, false);
  assert.equal(await nativeEnabled(restored.app), false);
  await verifyWordScope(restored.live, 'receive', false);
} finally {
  await restored.app.close();
}

console.log('Fresh and upgraded profiles default to off. Opt-in, technical exclusions, prose suggestions and correction, save, restart and disable passed.');

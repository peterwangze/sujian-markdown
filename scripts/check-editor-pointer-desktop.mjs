import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const working = await mkdtemp(path.join(tmpdir(), 'sujian-pointer-qa-'));
const file = path.join(working, '指针编辑.md');
const markdown = [
  '# Heading headingword tail.',
  'Source drag selection remains editable.',
  'Alpha removed gamma.',
  '- Unordered unorderedword tail.\n  - Nested nestedword tail.',
  '1. Ordered sequenceword tail.',
  '- [x] Task taskword tail.',
  '| Cell | State |\n| --- | --- |\n| Table tableword tail. | Ready |',
  '```js\nconst codeword = 42;\n```',
].join('\n\n') + '\n';
await writeFile(file, markdown);

const executablePath = process.env.SUJIAN_QA_EXE;
const args = [`--user-data-dir=${path.join(working, 'profile')}`];
if (!executablePath) args.push(project);
args.push(file);
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) });
const page = await app.firstWindow();
page.setDefaultTimeout(7000);

const live = page.getByLabel('Markdown 即时编辑');
const source = page.getByLabel('Markdown 源码');
const menu = page.getByRole('menu');
const tab = page.getByRole('tab').filter({ hasText: '指针编辑.md' });
const button = (name) => page.getByRole('button', { name, exact: true });
const item = (name) => menu.getByRole('menuitem', { name, exact: true });
const failures = [];
const contexts = [
  { name: 'heading', tag: 'h1', word: 'headingword', menuItem: '插入链接…' },
  { name: 'prose', tag: 'p', word: 'removed', menuItem: '插入链接…' },
  { name: 'unordered list', tag: 'li', word: 'unorderedword', menuItem: '插入链接…' },
  { name: 'nested list', tag: 'li', word: 'nestedword', menuItem: '插入链接…' },
  { name: 'ordered list', tag: 'li', word: 'sequenceword', menuItem: '插入链接…' },
  { name: 'task list', tag: 'li', word: 'taskword', menuItem: '插入链接…' },
  { name: 'table', tag: 'td', word: 'tableword', menuItem: '下方插入行' },
];

async function documentAction(name) {
  await button('文档与视图').click();
  await page.locator('.tool-menu-list').getByRole('button', { name, exact: true }).click();
}

async function textPoints(locator, text) {
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate((element, text) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent.includes(text)) node = walker.nextNode();
    if (!node) throw new Error(`No text node contains ${text}`);
    const from = node.textContent.indexOf(text);
    const range = document.createRange();
    const point = (offset) => {
      range.setStart(node, offset);
      range.collapse(true);
      const bounds = range.getBoundingClientRect();
      return { x: bounds.x, y: bounds.top + bounds.height / 2 };
    };
    const start = point(from);
    const end = point(from + text.length);
    return { start, end, middle: { x: (start.x + end.x) / 2, y: start.y } };
  }, text);
}

async function drag({ start, end }, backward = false) {
  const [from, to] = backward ? [end, start] : [start, end];
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up({ button: 'left' });
}

function selection() {
  return page.evaluate(() => {
    const current = document.getSelection();
    return { text: current.toString(), direction: current.direction };
  });
}

async function verifySelection(text, backward) {
  assert.deepEqual(await selection(), { text, direction: backward ? 'backward' : 'forward' });
}

async function rightClick(point) {
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await menu.waitFor();
}

async function verifyContextMenus(locator, word, expected, backward, keepDirection = true) {
  const selected = await textPoints(locator, word);
  await drag(selected, backward);
  if (keepDirection) await verifySelection(word, backward);
  else assert.equal((await selection()).text, word);
  await rightClick((await textPoints(locator, word)).middle);
  await item('复制').waitFor();
  assert.equal(await menu.getAttribute('data-selection'), 'true');
  await page.keyboard.press('Escape');
  if (keepDirection) await verifySelection(word, backward);
  else assert.equal((await selection()).text, word);
  const outside = await textPoints(locator, word === 'codeword' ? 'const' : 'tail');
  await rightClick(outside.middle);
  await item(expected).waitFor();
  assert.equal(await menu.getAttribute('data-selection'), null);
  await page.keyboard.press('Escape');
  assert.equal((await selection()).text, '');
}

async function check(name, run) {
  try {
    await run();
    console.log(`${name} passed.`);
  } catch (error) {
    failures.push(error);
    console.error(`${name} failed: ${error.message}`);
  }
}

try {
  await page.waitForSelector('.application[data-ready="true"]');
  await tab.click();
  await page.evaluate(() => document.fonts.ready);
  for (const mode of ['源码', '分栏预览']) {
    await check(`${mode} mouse drag and highlight`, async () => {
      if (mode === '源码') await button(mode).click();
      else await documentAction(mode);
      const line = source.locator('.cm-line').filter({ hasText: 'Source drag selection remains editable.' });
      const selected = await textPoints(line, 'drag selection');
      const outside = await textPoints(line, 'remains');
      const layer = page.locator('.editor-source .cm-selectionBackground');
      for (const backward of [false, true]) {
        await drag(selected, backward);
        await verifySelection('drag selection', backward);
        await layer.first().waitFor({ state: 'visible' });
        const background = await layer.first().evaluate((element) => getComputedStyle(element).backgroundColor);
        await rightClick(selected.middle);
        await item('复制').waitFor();
        assert.equal(await menu.getAttribute('data-selection'), 'true');
        await page.keyboard.press('Escape');
        await verifySelection('drag selection', backward);
        await rightClick(outside.middle);
        await item('插入链接…').waitFor();
        assert.equal(await menu.getAttribute('data-selection'), null);
        await page.keyboard.press('Escape');
        assert.equal(await selection().then((value) => value.text), '');
        assert.doesNotMatch(background, /^transparent$|^rgba\([^)]*,\s*0\)$/, `selection background is ${background}`);
      }
    });
  }
  await button('源码').click();
  await check('Source moving an existing text selection', async () => {
    const line = source.locator('.cm-line').filter({ hasText: 'Source ' });
    const selected = await textPoints(line, 'drag selection');
    const end = (await textPoints(line, 'editable.')).end;
    await drag(selected);
    await verifySelection('drag selection', false);
    await page.mouse.move(selected.middle.x, selected.middle.y);
    await page.mouse.down();
    await page.mouse.move(selected.middle.x + 7, selected.middle.y, { steps: 7 });
    await page.mouse.move(end.x + 1, end.y, { steps: 15 });
    await page.mouse.move(end.x + 1, end.y);
    await page.mouse.up();
    assert.equal(await line.textContent(), 'Source  remains editable.drag selection');
    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+z`);
    assert.equal(await line.textContent(), 'Source drag selection remains editable.');
  });
  for (const { name, word } of [...contexts, { name: 'code', word: 'codeword' }]) {
    if (name === 'prose') continue;
    await check(`Source ${name} selection context`, () => verifyContextMenus(
      source.locator('.cm-line').filter({ hasText: word }), word, name === 'code' ? '复制代码' : '插入链接…', true,
    ));
  }

  await button('即时').click();
  const struck = (word) => live.locator('s, del').filter({ hasText: word });
  const liveContext = ({ tag, word }) => live.locator(tag).filter({ hasText: word }).last();
  async function strike(locator, text, backward, keepDirection = true) {
    await page.keyboard.press('ArrowRight');
    const points = await textPoints(locator, text);
    await drag(points, backward);
    if (keepDirection) await verifySelection(text, backward);
    else assert.equal((await selection()).text, text);
    await rightClick((await textPoints(locator, text)).middle);
    assert.equal(await menu.getAttribute('data-selection'), 'true');
    await item('删除线').click();
  }
  for (const context of contexts) {
    const { name, word, menuItem } = context;
    await check(`Live ${name} selection and strikethrough`, async () => {
      const locator = liveContext(context);
      if (name !== 'prose') await verifyContextMenus(locator, word, menuItem, true, name !== 'heading');
      // Preserve whitespace outside the Markdown delimiters when the drag picks it up.
      await strike(locator, name === 'prose' ? word : ` ${word} `, true, name !== 'heading');
      const result = struck(word);
      assert.equal(await result.count(), 1, `Expected strike markup, found ${await locator.innerHTML()}`);
      assert.match(await result.evaluate((element) => getComputedStyle(element).textDecorationLine), /line-through/);
      if (name === 'prose') {
        await strike(result, word, false);
        assert.equal(await result.count(), 0);
        assert.equal(await locator.textContent(), 'Alpha removed gamma.');
        await strike(locator, word, true);
        await result.waitFor();
      }
    });
  }
  await check('Live code selection only offers code actions', async () => {
    await live.locator('[data-type="code-block"] pre.vditor-ir__preview').click();
    const code = live.locator('[data-type="code-block"] pre.vditor-ir__marker--pre > code');
    const selected = await textPoints(code, 'codeword');
    await drag(selected);
    await verifySelection('codeword', false);
    await rightClick((await textPoints(code, 'codeword')).middle);
    assert.equal(await menu.getAttribute('data-selection'), 'true');
    await item('复制代码').waitFor();
    await item('代码语言…').waitFor();
    assert.equal(await item('删除线').count(), 0);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    const block = live.locator('[data-type="code-block"]');
    assert.match(await block.getAttribute('class'), /\bvditor-ir__node--expand\b/);
    await verifySelection('codeword', false);
    await button('标题级别').focus();
    assert.doesNotMatch(await block.getAttribute('class'), /\bvditor-ir__node--expand\b/);
  });

  const expected = contexts.reduce((source, { word }) => source.replace(word, `~~${word}~~`), markdown);
  const normalizeTableLayout = (text) => text.replace(/^\|.*\|$/gm, (row) => row.split('|')
    .map((cell) => cell.trim().replace(/^(:?)-{3,}(:?)$/, '$1---$2')).join('|'));
  await check('Save and reopen Markdown with exact strike delimiters', async () => {
    await documentAction('保存');
    await tab.locator('[title="有未保存的改动"]').waitFor({ state: 'detached' });
    assert.equal(normalizeTableLayout(await readFile(file, 'utf8')), normalizeTableLayout(expected));
    const modifier = process.platform === 'darwin' ? 'meta' : 'control';
    const nativeKey = (keyCode, modifiers) => app.evaluate(({ BrowserWindow }, input) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.focus();
      for (const type of ['keyDown', 'keyUp']) {
        window.webContents.sendInputEvent({ type, ...input });
      }
    }, { keyCode, modifiers });
    await nativeKey('W', [modifier]);
    await tab.waitFor({ state: 'detached' });
    await nativeKey('T', [modifier, 'shift']);
    await tab.waitFor();
    await button('即时').click();
    for (const { word } of contexts) await struck(word).waitFor();
  });
  if (failures.length) throw new AggregateError(failures, `${failures.length} pointer regressions`);
} finally {
  await app.close();
}

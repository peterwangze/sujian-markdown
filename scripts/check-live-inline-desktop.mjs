import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const working = await mkdtemp(path.join(tmpdir(), 'sujian-inline-qa-'));
const file = path.join(working, '行内格式.md');
const contexts = [
  ['Heading', 'h1', (text) => `# ${text}`],
  ['Prose', 'p', (text) => text],
  ['Quote', 'blockquote p', (text) => `> ${text}`],
  ['Bullet', 'li', (text) => `- ${text}`],
  ['Nested', 'li li', (text) => `- Parent\n  - ${text}`],
  ['Numbered', 'ol li', (text, index) => `${index + 1}. ${text}`],
  ['Task', 'li', (text) => `- [x] ${text}`],
  ['Table', 'td', (text) => `| Section | Other |\n| --- | --- |\n| ${text} | Keep |`],
];
const formats = [
  { name: '加粗', word: 'Bold', tag: 'strong', marker: '**' },
  { name: '斜体', word: 'Italic', tag: 'em', marker: '*' },
  { name: '删除线', word: 'Strike', tag: 's, del', marker: '~~' },
  { name: '行内代码', word: 'Code', tag: 'code', marker: '`' },
];
const toolbarFormats = [
  ['高亮', 'mark', 'Highlighted words', '=='],
  ['上标', 'sup', 'Raised words', '^'],
  ['下标', 'sub', 'Lowered words', '~'],
];
const markdown = [
  ...contexts.map(([context, selector, block]) => {
    const rows = formats.map(({ word }, index) => block(`Before ${context}${word} after.`, index));
    return `## ${context} samples\n\n${rows.join(selector.includes('li') ? '\n' : '\n\n')}`;
  }),
  'Keyboard boundary partialword remains.', 'Toolbar boundary anotherword remains.',
  'Mixed lead **BoldInside** and PlainInside tail.',
  'Toggle lead **BeforeToggle CenterToggle AfterToggle** tail.',
  'Underline lead UnderlineInside tail.',
  ...toolbarFormats.map(([, , word]) => `Extra ${word} stay readable.`),
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
const tab = page.getByRole('tab').filter({ hasText: '行内格式.md' });
const menu = page.getByRole('menu');
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
const failures = [];
const mac = process.platform === 'darwin';

async function textPoints(locator, text) {
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate((element, text) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement.closest('.vditor-ir__marker') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [];
    let content = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.length) continue;
      nodes.push({ node, start: content.length, end: content.length + node.length });
      content += node.textContent;
    }
    const index = content.indexOf(text);
    if (index < 0) throw new Error(`Cannot find ${JSON.stringify(text)} in ${JSON.stringify(content)}`);
    const point = (offset, end) => {
      const part = nodes.find(({ start, end: boundary }) => end ? start < offset && offset <= boundary : start <= offset && offset < boundary);
      if (!part) throw new Error(`No text point for ${offset}`);
      const range = document.createRange();
      range.setStart(part.node, offset - part.start);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.top + rect.height / 2 };
    };
    const start = point(index, false);
    const end = point(index + text.length, true);
    return { start, end };
  }, text);
}

async function drag(locator, text, backward, plain = false) {
  const { start, end } = await textPoints(locator, text);
  const [from, to] = backward ? [end, start] : [start, end];
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  const selected = await page.evaluate(() => getSelection().toString());
  assert.equal(plain ? selected.replaceAll('**', '') : selected, text);
}

async function applyMenu(locator, text, name) {
  const { start, end } = await textPoints(locator, text);
  await page.mouse.click((start.x + end.x) / 2, (start.y + end.y) / 2, { button: 'right' });
  await menu.getByRole('menuitem', { name, exact: true }).click();
}

async function check(name, action) {
  try {
    await action();
    console.log(`${name} passed.`);
  } catch (error) {
    failures.push(error);
    console.error(`${name}: ${error.message}`);
    if (await menu.isVisible()) await page.keyboard.press('Escape');
  }
}

async function documentAction(name) {
  await button('文档与视图').click();
  await button(name, page.locator('.tool-menu-list')).click();
}

function nativeKey(keyCode, ...modifiers) {
  return app.evaluate(({ BrowserWindow }, input) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.focus();
    for (const type of ['keyDown', 'keyUp']) window.webContents.sendInputEvent({ type, ...input });
  }, { keyCode, modifiers: [mac ? 'meta' : 'control', ...modifiers] });
}

try {
  await page.waitForSelector('.application[data-ready="true"]');
  await tab.click();
  await live.waitFor();
  await page.evaluate(() => document.fonts.ready);

  for (const [context, selector] of contexts) {
    for (const [index, { name, word, tag }] of formats.entries()) {
      const target = context + word;
      const block = live.locator(selector).filter({ hasText: target }).last();
      await check(`${context} ${name}`, async () => {
        const before = await textPoints(block, 'Before');
        await page.mouse.click((before.start.x + before.end.x) / 2, before.start.y);
        await drag(block, ` ${target} `, index % 2 === 0);
        await applyMenu(block, target, name);
        const formatted = block.locator(tag).filter({ hasText: target });
        assert.equal(await formatted.count(), 1, await block.innerHTML());
        assert.equal(await formatted.textContent(), target);
      });
    }
  }

  await check('Keyboard bold and toolbar italic on partial words', async () => {
    const keyboard = live.locator('p').filter({ hasText: 'Keyboard boundary' });
    await drag(keyboard, 'tial', true);
    await page.keyboard.press(`${mac ? 'Meta' : 'Control'}+b`);
    assert.equal(await keyboard.locator('strong').textContent(), 'tial');
    const toolbar = live.locator('p').filter({ hasText: 'Toolbar boundary' });
    await drag(toolbar, 'other', false);
    await button('斜体').click();
    assert.equal(await toolbar.locator('em').textContent(), 'other');
  });

  await check('Mixed formatted and unformatted text retains both styles', async () => {
    const mixed = live.locator('p').filter({ hasText: 'Mixed lead' });
    const assertMixed = async () => {
      const text = await mixed.locator('em').evaluate((element) => {
        const clean = element.cloneNode(true);
        clean.querySelectorAll('.vditor-ir__marker').forEach((marker) => marker.remove());
        return clean.textContent;
      });
      assert.equal(text, 'BoldInside and PlainInside');
      assert.equal(await mixed.locator('em strong').textContent(), 'BoldInside');
    };
    await page.waitForTimeout(900);
    await drag(mixed, 'BoldInside and PlainInside', true, true);
    await applyMenu(mixed, 'BoldInside and PlainInside', '斜体');
    await assertMixed();
    // Vditor groups edits into undo snapshots after a short idle period.
    await page.waitForTimeout(900);
    const modifier = mac ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+z`);
    assert.equal(await mixed.locator('em').count(), 0);
    assert.equal(await mixed.locator('strong').textContent(), 'BoldInside');
    await button('更多编辑工具').click();
    await button('重做', page.locator('.tool-menu-list')).click();
    await assertMixed();
  });

  await check('Toggling a bold substring keeps bold text on both sides', async () => {
    const paragraph = live.locator('p').filter({ hasText: 'Toggle lead' });
    await drag(paragraph, 'CenterToggle', true);
    await applyMenu(paragraph, 'CenterToggle', '加粗');
    assert.deepEqual(await paragraph.locator('strong').allTextContents(), ['BeforeToggle', 'AfterToggle']);
    assert.equal(await paragraph.locator('strong').filter({ hasText: 'CenterToggle' }).count(), 0);
  });

  await check('Keyboard underline on a selection preserves surrounding whitespace', async () => {
    const paragraph = live.locator('p').filter({ hasText: 'Underline lead' });
    await drag(paragraph, ' UnderlineInside ', true);
    await page.keyboard.press(`${mac ? 'Meta' : 'Control'}+u`);
    const underline = paragraph.locator('u, [data-sujian-inline-html="u"]');
    assert.equal(await underline.textContent(), 'UnderlineInside');
  });

  for (const [name, tag, word] of toolbarFormats) {
    await check(`Toolbar ${name} keeps multi-word text and surrounding whitespace`, async () => {
      const paragraph = live.locator('p').filter({ hasText: word });
      await drag(paragraph, ` ${word} `, true);
      await button('更多编辑工具').click();
      await button(name, page.locator('.tool-menu-list')).click();
      assert.equal(await paragraph.locator(tag).textContent(), word);
    });
  }

  const basic = contexts.reduce((text, [context]) => formats.reduce((value, { word, marker }) => {
    const target = context + word;
    return value.replace(target, `${marker}${target}${marker}`);
  }, text), markdown).replace('partialword', 'par**tial**word')
    .replace('anotherword', 'an*other*word')
    .replace('**BoldInside** and PlainInside', '***BoldInside** and PlainInside*')
    .replace('**BeforeToggle CenterToggle AfterToggle**', '**BeforeToggle** CenterToggle **AfterToggle**')
    .replace('UnderlineInside', '<u>UnderlineInside</u>');
  const expected = toolbarFormats.reduce((text, [, , word, marker]) => text.replace(word, `${marker}${word}${marker}`), basic);
  const normalizeTable = (text) => text.replace(/^\|.*\|$/gm, (row) => row.split('|')
    .map((cell) => cell.trim().replace(/^-{3,}$/, '---')).join('|'));
  await check('Exact Markdown save and reopen', async () => {
    await documentAction('保存');
    await tab.locator('[title="有未保存的改动"]').waitFor({ state: 'detached' });
    assert.equal(normalizeTable(await readFile(file, 'utf8')), normalizeTable(expected));
    await nativeKey('W');
    await tab.waitFor({ state: 'detached' });
    await nativeKey('T', 'shift');
    await tab.waitFor();
    await button('即时').click();
    for (const [context] of contexts) for (const { word, tag } of formats) {
      await live.locator(tag).filter({ hasText: context + word }).waitFor();
    }
    for (const [, tag, word] of toolbarFormats) await live.locator(tag).filter({ hasText: word }).waitFor();
  });
  if (failures.length) throw new AggregateError(failures, `${failures.length} inline formatting regressions`);
} finally {
  await app.close();
}

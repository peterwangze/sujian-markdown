import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const working = await mkdtemp(path.join(tmpdir(), 'sujian-shift-tab-qa-'));
const modes = ['源码', '分栏预览', '即时'];
const paths = modes.map((mode) => path.join(working, `${mode}缩进.md`));
const markdown = [
  '# Plain heading', '  # Indented heading', 'Plain paragraph', '  Indented paragraph',
  '- Root bullet\n  - Bullet child one\n  - Bullet child two\n    - Bullet grandchild\n- Final bullet',
  '1. Root number\n   1. Number child\n2. Final number',
  '- [ ] Root task\n  - [x] Task child\n- [ ] Final task',
  '| First head | Second head | Last head |\n| --- | --- | --- |\n| First cell | Second cell | Last cell |',
  '```js\n    alpha();\n        beta();\nnoIndent();\n```',
  '## Exit checks', '- Exit by Backspace\n- Exit by Enter',
].join('\n\n') + '\n';
await Promise.all(paths.map((file) => writeFile(file, markdown)));

const executablePath = process.env.SUJIAN_QA_EXE;
const args = [`--user-data-dir=${path.join(working, 'profile')}`];
if (!executablePath) args.push(project);
args.push(...paths);
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) });
const page = await app.firstWindow();
page.setDefaultTimeout(8000);
const live = page.getByLabel('Markdown 即时编辑');
const source = page.getByLabel('Markdown 源码');
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
const tab = (mode) => page.getByRole('tab').filter({ hasText: `${mode}缩进.md` });
const sourceLine = (text) => source.locator('.cm-line').filter({ hasText: text });
const outdent = () => page.keyboard.press('Shift+Tab');
const press = (key) => page.keyboard.press(key);
const mac = process.platform === 'darwin';

async function documentAction(name) {
  await button('文档与视图').click();
  await button(name, page.locator('.tool-menu-list')).click();
}

async function save(mode) {
  await documentAction('保存');
  await tab(mode).locator('[title="有未保存的改动"]').waitFor({ state: 'detached' });
  return readFile(paths[modes.indexOf(mode)], 'utf8');
}

async function sourceStart(text) {
  await sourceLine(text).click();
  await press('Home');
  await press('Home');
}

function richSelection(scope, anchor, focus = anchor) {
  return scope.evaluate((element, points) => {
    element.closest('[contenteditable]').focus();
    const findPoint = ({ text, offset }) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const index = node.textContent.indexOf(text);
        if (index >= 0) return [node, index + offset];
      }
      throw new Error(`Cannot find ${text}`);
    };
    getSelection().setBaseAndExtent(...findPoint(points.anchor), ...findPoint(points.focus));
  }, { anchor, focus });
}

const point = (text, offset = 0) => ({ text, offset });
const isFocused = (editor) => editor.evaluate((element) => element === document.activeElement);
const selectedText = () => page.evaluate(() => getSelection().toString());
const listDepth = (word) => live.evaluate((editor, text) => {
  const item = [...editor.querySelectorAll('li')].findLast((element) => element.textContent.includes(text));
  if (!item) throw new Error(`Cannot find list item ${text}`);
  let depth = 0;
  for (let parent = item; parent !== editor; parent = parent.parentElement) if (parent.matches('li')) depth++;
  return depth;
}, word);

async function sourceChecks(mode) {
  await tab(mode).click();
  if (mode === '源码') await button(mode).click();
  else await documentAction(mode);
  await source.waitFor();

  await sourceStart('Plain heading');
  await outdent();
  assert.equal(await sourceLine('Plain heading').textContent(), '# Plain heading');
  assert(await isFocused(source));
  await sourceStart('Indented heading');
  await press('ArrowRight');
  await outdent();
  assert.equal(await sourceLine('Indented heading').textContent(), '# Indented heading');
  await sourceStart('Plain paragraph');
  await press('ArrowRight');
  await outdent();
  assert.equal(await sourceLine('Plain paragraph').textContent(), 'Plain paragraph');
  await sourceStart('Indented paragraph');
  await press('Shift+End');
  await outdent();
  assert.equal(await sourceLine('Indented paragraph').textContent(), 'Indented paragraph');

  await sourceStart('Root bullet');
  await outdent();
  await press('Shift+End');
  await outdent();
  assert.equal(await sourceLine('Root bullet').textContent(), '- Root bullet');
  await sourceStart('Bullet child one');
  await press('Shift+ArrowDown');
  await press('Shift+End');
  await outdent();
  assert.equal(await sourceLine('Bullet child one').textContent(), '- Bullet child one');
  assert.equal(await sourceLine('Bullet child two').textContent(), '- Bullet child two');
  assert.equal(await sourceLine('Bullet grandchild').textContent(), '  - Bullet grandchild');
  await sourceStart('Number child');
  await outdent();
  assert.equal(await sourceLine('Number child').textContent(), '1. Number child');
  await sourceStart('Task child');
  await outdent();
  assert.equal(await sourceLine('Task child').textContent(), '- [x] Task child');

  await sourceStart('First cell');
  const tableRow = await sourceLine('First cell').textContent();
  await press('ArrowRight');
  await outdent();
  assert.equal(await sourceLine('First cell').textContent(), tableRow);
  assert(await isFocused(source));
  await sourceStart('alpha();');
  await press('ArrowRight');
  await outdent();
  assert.equal(await sourceLine('alpha();').textContent(), 'alpha();');
  await sourceStart('beta();');
  await press('Shift+ArrowDown');
  await press('Shift+End');
  await outdent();
  assert.equal(await sourceLine('beta();').textContent(), '    beta();');
  assert.equal(await sourceLine('noIndent();').textContent(), 'noIndent();');

  await source.press(mac ? 'Meta+ArrowDown' : 'Control+End');
  await sourceStart('Exit by Backspace');
  await press('ArrowRight');
  await press('ArrowRight');
  await press('Backspace');
  assert.equal(await sourceLine('Exit by Backspace').textContent(), 'Exit by Backspace');
  await sourceLine('Exit by Enter').click();
  await press('End');
  await press('Enter');
  assert.equal(await source.locator('.cm-activeLine').textContent(), '- ');
  await press('Enter');
  assert.equal(await source.locator('.cm-activeLine').textContent(), '');
  await press('Escape');
  await outdent();
  assert.equal(await isFocused(source), false);

  const saved = await save(mode);
  assert.match(saved, /^- Bullet child one\n- Bullet child two\n  - Bullet grandchild$/m);
  assert.match(saved, /^- \[x\] Task child$/m);
  assert.match(saved, /^```js\nalpha\(\);\n {4}beta\(\);\nnoIndent\(\);\n```$/m);
  assert.match(saved, /^Exit by Backspace$/m);
  console.log(`${mode} Shift+Tab, list exits, focus escape and disk Markdown passed.`);
}

async function liveChecks() {
  await tab('即时').click();
  await button('即时').click();
  await live.waitFor();

  const heading = live.locator('h1').filter({ hasText: 'Plain heading' });
  for (const offset of [0, 4]) {
    await richSelection(heading, point('Plain heading', offset));
    await outdent();
    assert.match(await heading.textContent(), /Plain heading/);
    assert(await isFocused(live), `Heading lost focus at offset ${offset}`);
  }
  await richSelection(heading, point('Plain heading', 5), point('Plain heading'));
  await outdent();
  assert.equal(await selectedText(), 'Plain');
  assert(await isFocused(live));
  const prose = live.locator('p').filter({ hasText: 'Plain paragraph' });
  for (const offset of [0, 4]) {
    await richSelection(prose, point('Plain paragraph', offset));
    await outdent();
    assert.equal(await prose.textContent(), 'Plain paragraph');
    assert(await isFocused(live));
  }
  await richSelection(prose, point('Plain paragraph', 5), point('Plain paragraph'));
  await outdent();
  assert.equal(await selectedText(), 'Plain');
  assert(await isFocused(live));
  await richSelection(prose, point('Plain paragraph'));
  await press('Tab');
  assert.equal(await prose.textContent(), '\u00a0'.repeat(4) + 'Plain paragraph');
  await richSelection(prose, point('Plain paragraph', 4));
  await outdent();
  assert.equal(await prose.textContent(), 'Plain paragraph');

  await richSelection(live, point('Root bullet', 1));
  await outdent();
  await richSelection(live, point('Root bullet'), point('Root bullet', 4));
  await outdent();
  assert.equal(await selectedText(), 'Root');
  assert.equal(await listDepth('Root bullet'), 1);
  assert.equal(await listDepth('Bullet child one'), 2);
  await richSelection(live, point('Bullet child two', 8), point('Bullet child one', 1));
  await outdent();
  assert.equal(await listDepth('Bullet child one'), 1);
  assert.equal(await listDepth('Bullet child two'), 1);
  assert.equal(await listDepth('Bullet grandchild'), 2);
  await richSelection(live, point('Number child', 2));
  await outdent();
  assert.equal(await listDepth('Number child'), 1);
  await richSelection(live, point('Task child', 2));
  await outdent();
  assert.equal(await listDepth('Task child'), 1);
  assert.equal(await live.locator('li').filter({ hasText: 'Task child' }).last().locator('input').isChecked(), true);

  const cellAtCaret = () => page.evaluate(() => {
    const anchor = getSelection().anchorNode;
    return (anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement).closest('th, td')?.textContent;
  });
  for (const [from, expected] of [['First head', 'First head'], ['Second head', 'First head'],
    ['Last head', 'Second head'], ['First cell', 'Last head'], ['Second cell', 'First cell'], ['Last cell', 'Second cell']]) {
    await richSelection(live, point(from, 2));
    await outdent();
    assert.equal(await cellAtCaret(), expected);
    assert(await isFocused(live));
  }

  const code = live.locator('pre.vditor-ir__marker--pre > code');
  await richSelection(code, point('alpha();', 2));
  await outdent();
  assert.equal(await code.textContent(), 'alpha();\n        beta();\nnoIndent();\n');
  await richSelection(code, point('noIndent();', 3), point('beta();', 2));
  await outdent();
  assert.equal(await code.textContent(), 'alpha();\n    beta();\nnoIndent();\n');
  assert.equal(await selectedText(), 'ta();\nnoI');

  await richSelection(live, point('Exit by Backspace'));
  await press('Backspace');
  await live.locator('p').getByText('Exit by Backspace', { exact: true }).waitFor();
  await richSelection(live, point('Exit by Enter', 'Exit by Enter'.length));
  await press('Enter');
  await press('Enter');
  assert.equal(await page.evaluate(() => {
    const node = getSelection().anchorNode;
    return Boolean((node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement).closest('li'));
  }), false);
  await press('Escape');
  await outdent();
  assert.equal(await isFocused(live), false);

  const saved = await save('即时');
  assert.match(saved, /^- Bullet child one\n- Bullet child two\n  - Bullet grandchild$/m);
  assert.match(saved, /^- \[x\] Task child$/m);
  assert.match(saved, /^```js\nalpha\(\);\n {4}beta\(\);\nnoIndent\(\);\n```$/m);
  assert.match(saved, /^Exit by Backspace$/m);
  console.log('Live Shift+Tab, list exits, focus escape and disk Markdown passed.');
}

try {
  await page.waitForSelector('.application[data-ready="true"]');
  await sourceChecks('源码');
  await sourceChecks('分栏预览');
  await liveChecks();
} finally {
  await app.close();
}

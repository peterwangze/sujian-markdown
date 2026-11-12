import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const working = await mkdtemp(path.join(tmpdir(), 'sujian-html-qa-'));
await mkdir(path.join(working, 'docs'));
await mkdir(path.join(working, 'build'));
await copyFile(path.join(project, 'build', 'icon.png'), path.join(working, 'build', 'icon.png'));
const fixture = path.join(working, 'docs', 'markdown-format-qa.md');
const unsafe = `

## HTML policy probes

CSS probe <span onclick="window.sujianUnsafeProbe=1" style="color:#0c2238; background-image:url(https://inline-css-test.invalid/probe); position:fixed; display:none; font-family:var(--sujian-private)">CSS filtered target</span>.

<style>body { opacity: .5; }</style>

<script>window.sujianUnsafeProbe=2</script>

<iframe title="HTML blocked frame" srcdoc="unsafe"></iframe>

HTML-POLICY-END
`;
const source = (await readFile(path.join(project, 'docs', 'markdown-format-qa.md'), 'utf8')) + unsafe;
await writeFile(fixture, source);

const args = ['--user-data-dir=' + path.join(working, 'profile')];
const executablePath = process.env.SUJIAN_QA_EXE;
if (!executablePath) args.push(project);
args.push(fixture);
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) });
const page = await app.firstWindow();
page.setDefaultTimeout(15000);
const errors = [];
const requests = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.context().route(/^https?:\/\//, (route) => {
  requests.push(route.request().url());
  return route.abort();
});
const live = page.getByLabel('Markdown 即时编辑');
const preview = page.locator('.editor-preview article');
const button = (name) => page.getByRole('button', { name, exact: true });

async function menu(name) {
  await button('文档与视图').click();
  await page.locator('.tool-menu-list').getByRole('button', { name, exact: typeof name === 'string' }).click();
}

function inlineTag(root, tag, text) {
  return root.locator(`:is(${tag}, [data-sujian-inline-html="${tag}"])`).filter({ hasText: text });
}

async function appearance(node) {
  return node.evaluate((el) => {
    const css = getComputedStyle(el);
    return {
      backgroundColor: css.backgroundColor, color: css.color, fontSize: css.fontSize,
      fontStyle: css.fontStyle, fontWeight: css.fontWeight, textAlign: css.textAlign,
      textDecoration: css.textDecorationLine, verticalAlign: css.verticalAlign,
    };
  });
}

async function checkAppearance(root) {
  await root.getByText('HTML-POLICY-END', { exact: true }).waitFor();
  const paragraph = root.locator('p').filter({ hasText: 'CM HTML highlight target' });
  const sub = inlineTag(paragraph, 'sub', '2');
  const sup = inlineTag(paragraph, 'sup', '2');
  assert.equal((await appearance(sub)).verticalAlign, 'sub');
  assert.equal((await appearance(sup)).verticalAlign, 'super');
  const mark = await appearance(inlineTag(paragraph, 'mark', 'CM HTML highlight target'));
  assert.notEqual(mark.backgroundColor, 'rgba(0, 0, 0, 0)');
  await inlineTag(paragraph, 'kbd', 'Ctrl').waitFor();
  assert.match((await appearance(inlineTag(paragraph, 'u', 'CM underline target'))).textDecoration, /underline/);
  assert(Number((await appearance(inlineTag(root, 'strong', 'CM HTML bold target'))).fontWeight) >= 600);
  assert.equal((await appearance(inlineTag(root, 'em', 'CM HTML italic target'))).fontStyle, 'italic');
  assert.match((await appearance(inlineTag(root, 'del', 'CM HTML deleted target'))).textDecoration, /line-through/);
  await inlineTag(root, 'code', 'CM HTML code target').waitFor();
  await inlineTag(root, 'rt', 'かん').waitFor();
  const styled = await appearance(inlineTag(root, 'span', 'CM HTML safe style target'));
  assert.equal(styled.color, 'rgb(178, 34, 34)');
  assert.equal(styled.fontSize, '24px');
  assert.equal(styled.backgroundColor, 'rgb(255, 244, 204)');
  const centered = root.getByText('CM HTML centered target', { exact: true });
  assert.equal((await appearance(centered)).textAlign, 'center');
  const filtered = inlineTag(root, 'span', 'CSS filtered target');
  const declarations = await filtered.evaluate((el) => ({
    color: getComputedStyle(el).color, style: el.getAttribute('style'), onClick: el.hasAttribute('onclick'),
  }));
  assert.equal(declarations.color, 'rgb(12, 34, 56)');
  assert.doesNotMatch(declarations.style, /url\(|position|display|var\(/i);
  assert.equal(declarations.onClick, false);
}

async function checkFolds(root, activate = (summary) => summary.click()) {
  const pure = root.locator('summary').filter({ hasText: 'CM details summary target' });
  const pureBody = root.getByText('CM details content target', { exact: true });
  assert.equal(await pureBody.isVisible(), false);
  await activate(pure);
  await pureBody.waitFor();
  await activate(pure);
  await pureBody.waitFor({ state: 'hidden' });

  const summary = root.locator('summary').filter({ hasText: 'CM mixed details summary target' });
  const nested = root.locator('summary').filter({ hasText: 'CM nested details summary target' });
  const body = root.getByText('CM mixed details body target', { exact: true });
  const item = root.getByText('CM mixed details list target', { exact: true });
  const nestedBody = root.getByText('CM nested details body target', { exact: true });
  const tail = root.getByText('CM mixed details HTML tail target', { exact: true });
  const after = root.getByText('CM after mixed details target', { exact: true });
  assert.equal(await body.isVisible(), false);
  assert.equal(await tail.isVisible(), false);
  await after.waitFor();
  await activate(summary);
  await body.waitFor();
  await item.waitFor();
  await tail.waitFor();
  await nestedBody.waitFor(); // The nested fixture uses the authored open attribute.
  await activate(nested);
  await nestedBody.waitFor({ state: 'hidden' });
  await activate(summary);
  await body.waitFor({ state: 'hidden' });
  await activate(summary);
  await body.waitFor();
  assert.equal(await nestedBody.isVisible(), false);
  await activate(nested);
  await nestedBody.waitFor();
  await activate(summary);
  await body.waitFor({ state: 'hidden' });
  await tail.waitFor({ state: 'hidden' });
  await after.waitFor();
}

async function checkPolicy(root) {
  assert.equal(await root.locator('script, style:not(svg *), iframe[title="HTML blocked frame"], [onclick], [srcdoc]').count(), 0);
}

try {
  await live.waitFor();
  await live.getByText('CM after HTML target', { exact: true }).click();
  await checkAppearance(live);
  await checkFolds(live);
  const summary = live.locator('summary').filter({ hasText: 'CM mixed details summary target' });
  await summary.press('Enter');
  await live.getByText('CM mixed details body target', { exact: true }).waitFor();
  await summary.press('Space');
  await live.getByText('CM mixed details body target', { exact: true }).waitFor({ state: 'hidden' });
  await live.getByText('跳到折叠区里的标题', { exact: true }).click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await live.getByText('CM mixed details body target', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.sujianUnsafeProbe), undefined);
  await menu('保存');
  assert.equal(await readFile(fixture, 'utf8'), source);
  console.log('Immediate editor rendered inline HTML and safe CSS, toggled nested folds by pointer and keyboard, and preserved source bytes.');

  for (const mode of ['分栏预览', '阅读模式']) {
    const [previous] = await preview.elementHandles();
    await menu(mode);
    if (previous) {
      await page.waitForFunction((element) => !element.isConnected, previous);
      await previous.dispose();
    }
    await checkAppearance(preview);
    await checkFolds(preview);
    await checkPolicy(preview);
  }
  console.log('Split and reading modes passed the same visual, folding and HTML safety checks.');

  const exportPath = path.join(working, 'markdown-format-qa.html');
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, exportPath);
  await menu(/^导出文档/);
  const dialog = page.getByRole('dialog', { name: '导出文档' });
  await dialog.getByRole('combobox').first().selectOption('html');
  await dialog.getByRole('button', { name: '导出', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const [exported] = await Promise.all([
    app.waitForEvent('window'),
    app.evaluate(async ({ BrowserWindow }, file) => {
      const exportWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
      await exportWindow.loadFile(file);
    }, exportPath),
  ]);
  const output = exported.locator('article');
  await checkAppearance(output);
  await checkFolds(output, (summary) => summary.evaluate((element) => element.click()));
  await checkPolicy(output);
  assert.equal(await exported.evaluate(() => globalThis.sujianUnsafeProbe), undefined);
  await exported.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log('Standalone HTML rendered the same styles, toggled folds, and passed safety checks.');
} finally {
  await app.close();
  console.log(`Acceptance artifacts: ${working}`);
}

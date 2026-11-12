import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron } from 'playwright';

const run = promisify(execFile);
const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const working = await mkdtemp(path.join(tmpdir(), 'sujian-markdown-qa-'));
const pandoc = process.env.SUJIAN_PANDOC || path.join(project, 'build', 'pandoc', `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'pandoc.exe' : 'pandoc');
const original = await readFile(path.join(project, 'docs', 'markdown-format-qa.md'));
await mkdir(path.join(working, 'docs'));
await mkdir(path.join(working, 'build'));
await copyFile(path.join(project, 'build', 'icon.png'), path.join(working, 'build', 'icon.png'));
const fixture = path.join(working, 'docs', 'markdown-format-qa.md');
await writeFile(fixture, original);
const breakFixture = path.join(working, 'breaks.md');
await writeFile(breakFixture, 'First\n\n> QuoteFirst\n\n- ItemFirst\n\nMiddleLast\n');
const app = await _electron.launch({ args: ['--user-data-dir=' + path.join(working, 'profile'), project, fixture] });
const page = await app.firstWindow();
page.setDefaultTimeout(15000);

const pageErrors = [];
const externalRequests = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.context().route(/^https?:\/\//, (route) => {
  externalRequests.push(route.request().url());
  return route.abort();
});

const button = (name) => page.getByRole('button', { name, exact: true });
const live = page.getByLabel('Markdown 即时编辑');
const preview = page.locator('.editor-preview');
const diagramNames = [
  'Mermaid start target', 'Mermaid sequence request target', 'Flowchart start target',
  'Flowchart alias start target', 'Sequence request target', 'Graphviz start target',
  'Graphviz named fence target', 'Nested quote diagram target', 'Nested list diagram target',
];

async function menu(name) {
  await button('文档与视图').click();
  await page.locator('.tool-menu-list').getByRole('button', { name, exact: typeof name === 'string' }).click();
}

async function exportFile(format) {
  const destination = path.join(working, `markdown-format-qa.${format}`);
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
  await menu(/^导出文档/);
  const dialog = page.getByRole('dialog', { name: '导出文档' });
  await dialog.getByRole('combobox').first().selectOption(format);
  await dialog.getByRole('button', { name: '导出', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  return destination;
}

async function checkDiagrams(root) {
  const container = await root.elementHandle();
  await page.waitForFunction(({ element, names }) => {
    const labels = [...element.querySelectorAll('svg')].map((svg) => svg.textContent.replace(/\s/g, ''));
    return names.every((name) => labels.some((label) => label.includes(name.replace(/\s/g, ''))));
  }, { element: container, names: diagramNames });
  await container.dispose();
}

async function checkPreview() {
  const article = preview.locator('article');
  await article.getByText('QA-END', { exact: true }).waitFor();
  await article.locator('strong').getByText('CM emphasis target').waitFor();
  assert.equal(await article.locator('ol[start="7"]').count(), 1);
  assert.equal(await article.locator('ol[start="7"] > li > ul').count(), 1);
  assert.equal(await article.locator('blockquote blockquote').count(), 1);
  assert.equal(await article.locator('pre > code.language-json.hljs').count(), 1);
  assert.equal(await article.locator('code.language-markdown').filter({ hasText: 'EDGE fenced Markdown target' }).count(), 1);
  assert.equal(await article.locator('p').filter({ hasText: 'CM hard break first' }).locator('br').count(), 1);
  assert.equal(await article.locator('p').filter({ hasText: 'CM two-space break first' }).locator('br').count(), 1);
  assert.match(await article.locator('td').getByText('GFM table target').innerText(), /GFM table target/);
  assert.equal(await article.locator('td > code').getByText('a|b', { exact: true }).count(), 1);
  assert.equal(await article.locator('input[type="checkbox"]:checked').count(), 2);
  assert.equal(await article.locator('input[type="checkbox"]:not(:checked)').count(), 2);
  assert.equal(await article.locator('s, del').getByText('过期下载地址').count(), 1);
  assert.equal(await article.locator('a[href="https://example.org/releases"]').count(), 1);
  for (const type of ['note', 'tip', 'important', 'warning', 'caution']) {
    await article.locator('.callout').filter({ hasText: `GITHUB alert ${type}` }).waitFor();
  }
  await article.getByText(/Footnote evidence target/).waitFor();
  assert.equal(await article.locator('mark').getByText('DOC highlight target').count(), 1);
  assert.equal(await article.locator('.vditor-toc a[href="#dialects"]').count(), 1);
  for (const id of ['release-review-v13', 'release-review-v13-1']) {
    assert.equal(await article.locator(`:is(h2,h3)[id="${id}"]`).count(), 1, id);
  }
  assert.equal(await article.locator('[id="pandoc-heading"]').count(), 1);
  for (const alt of ['CM local image target', 'CM reference image target']) {
    const image = article.getByAltText(alt, { exact: true });
    await image.waitFor();
    const handle = await image.elementHandle();
    await page.waitForFunction((element) => element.complete && element.naturalWidth > 0, handle);
    await handle.dispose();
  }
  const details = article.locator('details').filter({ hasText: 'CM details summary target' });
  const detail = details.getByText('CM details content target');
  assert.equal(await article.getByText('CM hidden comment target').count(), 0);
  assert.equal(await detail.isVisible(), false);
  await details.getByText('CM details summary target').click();
  await detail.waitFor();
  await details.getByText('CM details summary target').click();
  const inline = article.locator('p').filter({ hasText: 'MATH GitHub inline target' }).locator('span.language-math');
  assert.equal(await inline.locator('.katex-html').count(), 1);
  assert.equal(await inline.locator('.katex-display').count(), 0);
  assert.doesNotMatch(await inline.locator('.katex-html').textContent(), /[`‘’]/);
  assert.equal(await article.locator('.katex-display').count(), 2);
  await checkDiagrams(article);
  assert.equal(await article.locator('blockquote .markdown-diagram svg').count(), 1);
  assert.equal(await article.locator('li .markdown-diagram svg').count(), 1);
  assert.equal(await article.locator('.markdown-render-error').count(), 0);
}

async function checkHardBreak() {
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, breakFixture);
  await menu('打开文件');
  await page.getByText('breaks.md', { exact: true }).first().waitFor();
  await live.waitFor();
  for (const [selector, text, offset] of [['p', 'First', 5], ['blockquote p', 'QuoteFirst', 10], ['li', 'ItemFirst', 9], ['p', 'MiddleLast', 6]]) {
    const line = live.locator(selector).filter({ hasText: new RegExp(`^${text}$`) });
    await line.evaluate((element, index) => {
      element.closest('[contenteditable]').focus();
      window.getSelection().collapse(element.firstChild, index);
    }, offset);
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.insertText('Second');
  }
  const positions = await live.locator('p').filter({ hasText: /^First/ }).evaluate((paragraph) => {
    const range = document.createRange();
    return [paragraph.firstChild, paragraph.lastChild].map((text) => {
      range.selectNodeContents(text);
      return range.getBoundingClientRect().top;
    });
  });
  assert(positions[1] > positions[0], 'Second line must render below the first line in the editor.');
  await menu('保存');
  await page.getByRole('contentinfo').getByText('已保存', { exact: true }).waitFor();
  const saved = await readFile(breakFixture, 'utf8');
  for (const text of ['First<br>Second', '> QuoteFirst<br>Second', '- ItemFirst<br>Second', 'Middle<br>SecondLast']) assert(saved.includes(text), saved);
  await menu('分栏预览');
  await preview.locator('p').filter({ hasText: 'FirstSecond' }).locator('br').first().waitFor({ state: 'attached' });
}

try {
  await live.getByText('QA-END', { exact: true }).waitFor();
  await checkDiagrams(live);
  const inline = live.locator('p').filter({ hasText: 'MATH GitHub inline target' }).locator('.vditor-ir__preview .language-math');
  await inline.locator('.katex-html').waitFor({ state: 'attached' });
  assert.doesNotMatch(await inline.locator('.katex-html').textContent(), /[`‘’]/);
  assert.equal(await inline.locator('.katex-display').count(), 0);
  const json = live.locator('[data-type="code-block"]').filter({ hasText: '"offline": true' });
  await json.hover();
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('sujian:write-clipboard');
    ipcMain.handle('sujian:write-clipboard', (_event, data) => { globalThis.qaClipboard = data.text; });
  });
  await json.getByRole('button', { name: '复制', exact: true }).click();
  await json.getByRole('button', { name: '已复制', exact: true }).waitFor();
  const copied = await app.evaluate(() => globalThis.qaClipboard);
  assert.match(copied, /"offline": true/);
  await menu('保存');
  await page.getByRole('contentinfo').getByText('已保存', { exact: true }).waitFor();
  assert.deepEqual(await readFile(fixture), original);
  console.log('Immediate editor, offline diagrams, inline formula and unedited source round trip passed.');

  await menu('分栏预览');
  await checkPreview();
  await menu('阅读模式');
  await checkPreview();
  console.log('Split and reading views passed Markdown structure, links, local images, details, math and diagram checks.');

  const html = await readFile(await exportFile('html'), 'utf8');
  const labels = await page.evaluate((markup) => [...new DOMParser().parseFromString(markup, 'text/html').querySelectorAll('.markdown-diagram svg')]
    .map((svg) => svg.textContent.replace(/\s/g, '')), html);
  for (const name of diagramNames) assert(labels.some((label) => label.includes(name.replace(/\s/g, ''))), name);
  assert.match(html, /data:font\/woff2;base64,/);
  assert.match(html, /src="data:image\/png;base64,/);
  assert.match(html, /id="release-review-v13-1"/);
  assert.match(html, /QA-END/);
  const pdf = await readFile(await exportFile('pdf'));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert(pdf.length > 15000);

  for (const format of ['docx', 'epub']) {
    const destination = await exportFile(format);
    const { stdout } = await run(pandoc, ['--from', format, '--to', 'html', '--mathml', destination], { cwd: project });
    const result = await page.evaluate((markup) => {
      const doc = new DOMParser().parseFromString(markup, 'text/html');
      return {
        quoted: doc.querySelector('blockquote img[alt="mermaid"]') !== null,
        listed: doc.querySelector('li img[alt="mermaid"]') !== null,
        diagrams: doc.querySelectorAll('img:is([alt="mermaid"], [alt="flow"], [alt="flowchart"], [alt="sequence"], [alt="graphviz"], [alt="dot"])').length,
        inlineMath: [...doc.querySelectorAll('p')].find((line) => line.textContent.includes('MATH GitHub inline target'))?.querySelector('math')?.textContent,
        displayMath: doc.querySelectorAll('math[display="block"]').length,
        end: doc.body.textContent.includes('QA-END'),
      };
    }, stdout);
    assert.equal(result.diagrams, diagramNames.length, `${format}: ${JSON.stringify(result)}`);
    assert(result.quoted && result.listed && result.end, `${format}: ${JSON.stringify(result)}`);
    assert(result.inlineMath && !/[`‘’]/.test(result.inlineMath), `${format}: ${JSON.stringify(result)}`);
    assert.equal(result.displayMath, 2, `${format}: ${JSON.stringify(result)}`);
  }
  console.log('HTML, PDF, Word and EPUB exports generated. Word and EPUB round trip kept all nine diagram images and their nested containers.');
  await button('即时').click();
  await checkHardBreak();
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  console.log('Shift+Enter survives typing and save in paragraphs, quotes and lists. No browser errors or HTTP requests.');
} finally {
  await app.close();
  console.log(`Acceptance artifacts: ${working}`);
}

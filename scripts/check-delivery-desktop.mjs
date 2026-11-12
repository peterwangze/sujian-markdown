import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'
import { waitForCheck } from './desktop-checks.mjs'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-delivery-'))
const fixture = path.join(working, '交付样稿.md')
const marker = 'DeliverySample2026'
const markdown = [
  '# Delivery sample', '', marker + ' with **bold text** and [a link](https://example.org).', '',
  '- [x] Review complete', '', '| Format | Status |', '| --- | --- |', '| Docs | Ready |', '',
  '## Second section', '', '~~~js', 'console.log("ok");', '~~~', '',
].join('\n')
await writeFile(fixture, markdown)

const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + path.join(working, 'profile')]
if (!executablePath) args.push(project)
args.push(fixture)
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(30000)
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const dialog = page.getByRole('dialog', { name: '导出文档', exact: true })
const format = dialog.getByRole('combobox', { name: '格式' })
const outputs = new Map()
const extensions = {
  html: 'html', 'html-plain': 'html', revealjs: 'html', latex: 'tex', plain: 'txt', mediawiki: 'wiki',
  gfm: 'md', commonmark: 'md', markdown: 'md', markdown_extra: 'md', custom: 'adoc',
}

async function action(name) {
  await button('文档与视图').click()
  await button(name, page.locator('.tool-menu-list')).click()
}

async function nativeSave(filePath) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: !filePath, filePath })
  }, filePath)
}

async function finishExport(key) {
  await format.selectOption(key)
  if (key === 'custom') {
    await dialog.getByRole('textbox', { name: 'Pandoc 输出格式' }).fill('asciidoc')
    await dialog.getByRole('textbox', { name: '文件扩展名' }).fill('adoc')
  }
  if (key === 'pdf') {
    await dialog.getByRole('combobox', { name: '纸张' }).selectOption('Letter')
    await dialog.getByRole('checkbox', { name: '横向' }).check()
  }
  await button('导出', dialog).click()
  const error = dialog.getByRole('alert')
  await Promise.race([dialog.waitFor({ state: 'hidden' }), error.waitFor()])
  if (await error.isVisible()) throw new Error(`${key}: ${await error.textContent()}`)
}

try {
  await page.waitForSelector('.application[data-ready="true"]')
  await page.getByLabel('Markdown 即时编辑').getByText(marker, { exact: false }).waitFor()
  await action('导出文档')
  await nativeSave(null)
  await format.selectOption('plain')
  await button('导出', dialog).click()
  await button('取消', dialog).waitFor({ state: 'visible' })
  await button('取消', dialog).click()
  await dialog.waitFor({ state: 'hidden' })

  await action('导出文档')
  await nativeSave(fixture)
  await format.selectOption('html')
  await button('导出', dialog).click()
  await dialog.getByRole('alert').getByText(/与原文档相同/).waitFor()
  assert.equal(await readFile(fixture, 'utf8'), markdown)
  const formats = await format.locator('option').evaluateAll(items => items.map(item => item.value))
  assert.equal(formats.length, 22)

  for (const [index, key] of formats.entries()) {
    if (index) await action('导出文档')
    const output = path.join(working, `output-${key}.${extensions[key] ?? key}`)
    await nativeSave(output)
    await finishExport(key)
    const data = await readFile(output)
    outputs.set(key, output)
    if (key === 'pdf') {
      assert.equal(data.subarray(0, 4).toString(), '%PDF')
      assert.match(data.toString('latin1'), /\/MediaBox\s*\[0 0 792 612\]/)
    } else if (key === 'png') {
      assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
      assert.ok(data.readUInt32BE(16) > 300 && data.readUInt32BE(20) > 100)
    } else if (['docx', 'odt', 'epub'].includes(key)) {
      assert.equal(data.subarray(0, 2).toString(), 'PK')
      const entries = { docx: 'word/document.xml', odt: 'content.xml', epub: 'META-INF/container.xml' }
      assert.ok(data.includes(entries[key]), key)
    } else {
      const text = data.toString('utf8')
      // The OPML writer stores headings as outlines, while the other text formats retain prose.
      assert.ok(text.includes(key === 'opml' ? 'Delivery sample' : marker), key)
      if (key === 'html' || key === 'html-plain') {
        assert.ok(/<h1[^>]*>(?:<span[^>]*><\/span>)?Delivery sample<\/h1>/.test(text), key)
        assert.equal(/<style\b/i.test(text), key === 'html')
      }
    }
    console.log(`Exported ${key} (${data.length} bytes)`)
  }

  for (const key of ['docx', 'odt', 'epub', 'html', 'rtf']) {
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, outputs.get(key))
    await action('导入文档')
    await page.getByRole('tab', { selected: true, name: `output-${key}.md` }).waitFor()
    await button('源码').click()
    await page.getByLabel('Markdown 源码').getByText(marker, { exact: false }).first().waitFor()
  }
  assert.equal(await readFile(fixture, 'utf8'), markdown)
  await page.getByRole('tab', { name: '交付样稿.md', exact: true }).click()
  await app.evaluate(({ app }) => {
    app.once('browser-window-created', (_event, window) => {
      window.webContents.print = (options, done) => {
        globalThis.deliveryPrintRequest = { options, url: window.webContents.getURL() }
        done(false, 'Print job canceled')
      }
    })
  })
  await action('打印')
  await waitForCheck('Expected a prepared document to reach the native print boundary', () => app.evaluate(() => {
    const request = globalThis.deliveryPrintRequest
    return request?.options.printBackground === true && request.url.startsWith('file:')
  }))
  assert.equal(await page.getByRole('tab', { selected: true }).textContent(), '交付样稿.md')
  console.log('Passed desktop export (22 formats), native save cancellation, original protection and five import round trips.')
} finally {
  await app.close()
}

import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-table-layout-'))
const fixture = path.join(working, '长表格.md')
const identifier = 'SujianLongTableIdentifier'.repeat(9)
const url = 'https://example.invalid/' + 'LongTableUrlSegment'.repeat(10)
const code = 'readLongTableConfiguration'.repeat(8)
const heading = 'LongTableColumnHeading'.repeat(5)
const rows = [
  ['Sentence', 'A long sentence should wrap naturally within a table cell while its neighbouring columns remain readable. '.repeat(4).trim()],
  ['Chinese', '这段中文内容需要在单元格内部自动换行并保留整个表格的边界。'.repeat(6)],
  ['Identifier', identifier],
  ['URL', `[${url}](${url})`],
  ['Code', '\`' + code + '\`'],
]
const source = [
  '# Table layout',
  '',
  `| Type | ${heading} | Status |`,
  '| :--- | :---: | ---: |',
  ...rows.map(([name, content]) => `| ${name} | ${content} | Done |`),
  '',
  '| Name | Value |',
  '| --- | ---: |',
  '| Count | 12 |',
  '',
  '> | Nested | Result |',
  '> | --- | --- |',
  `> | ${identifier} | OK |`,
  '',
].join('\n')
await writeFile(fixture, source)

const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + path.join(working, 'profile')]
if (!executablePath) args.push(project)
args.push(fixture)
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(10000)
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const live = page.getByLabel('Markdown 即时编辑')
const preview = page.locator('.editor-preview article')
const exportDialog = page.getByRole('dialog', { name: '导出文档', exact: true })
const failures = []

function tableMetrics(root, { live = false } = {}) {
  const tolerance = 1
  function bounds(element) {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      left: rect.left + (live ? parseFloat(style.paddingLeft) : 0),
      right: rect.right - (live ? parseFloat(style.paddingRight) : 0),
    }
  }

  function measure(table) {
    const boundary = bounds(table.closest('blockquote') ?? root)
    const quote = table.closest('blockquote')
    if (quote) {
      const style = getComputedStyle(quote)
      const rect = quote.getBoundingClientRect()
      boundary.left = rect.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth)
      boundary.right = rect.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth)
    }
    const rect = table.getBoundingClientRect()
    const cells = Array.from(table.rows, row => Array.from(row.cells, cell => {
      const cellRect = cell.getBoundingClientRect()
      const boxes = []
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode
        if (!node.textContent.trim() || node.parentElement.closest('.vditor-ir__marker')) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        boxes.push(...Array.from(range.getClientRects()).filter(box => box.width > 0))
      }
      const lines = new Set(boxes.map(box => Math.round(box.top))).size
      return {
        width: cellRect.width, align: getComputedStyle(cell).textAlign.replace(/^-webkit-/, ''), lines,
        contained: boxes.every(box => box.left >= cellRect.left - tolerance && box.right <= cellRect.right + tolerance),
        left: cellRect.left, right: cellRect.right,
      }
    }))
    return {
      available: boundary.right - boundary.left, width: rect.width, cells,
      contained: rect.left >= boundary.left - tolerance && rect.right <= boundary.right + tolerance &&
        cells.flat().every(cell => cell.contained && cell.left >= boundary.left - tolerance && cell.right <= boundary.right + tolerance),
    }
  }
  return Array.from(root.querySelectorAll('table'), measure)
}

function assertLayout(tables, label, { narrow = false } = {}) {
  assert.equal(tables.length, 3, `${label} table count`)
  const [long, short, nested] = tables
  if (narrow) assert.ok(long.available <= 521, `${label} expected at most 520px, got ${long.available}px`)
  for (const table of tables) {
    assert.ok(table.contained, `${label} table ${table.width.toFixed(1)}px overflows ${table.available.toFixed(1)}px`)
  }
  assert.ok(long.cells[0][1].lines > 1, `${label} did not wrap long header`)
  assert.ok(long.cells[0][2].lines <= (long.available < 400 ? 2 : 1), `${label} excessively wrapped short header`)
  for (const [index, [name]] of rows.entries()) {
    const [kind, content, status] = long.cells[index + 1]
    assert.ok(content.lines > 1, `${label} ${name} did not wrap`)
    assert.equal(status.lines, 1, `${label} wrapped short status`)
    assert.equal(content.align, 'center', `${label} ${name} center alignment`)
    assert.equal(status.align, 'right', `${label} ${name} right alignment`)
    assert.ok(content.width > kind.width && content.width > status.width, `${label} ${name} text column did not receive extra width`)
  }
  assert.ok(short.cells.flat().every(cell => cell.lines === 1), `${label} wrapped short table`)
  assert.ok(nested.cells[1][0].lines > 1, `${label} did not wrap quoted table`)
  console.log(`${label}: ${long.width.toFixed(1)} / ${long.available.toFixed(1)}px; long cells span ${long.cells.slice(1).map(row => row[1].lines).join(', ')} lines.`)
}

async function check(label, task) {
  try {
    await task()
  } catch (error) {
    failures.push(label)
    console.error(`${label}: ${error.message.replace(/\s+/g, ' ').slice(0, 500)}`)
  }
}

async function action(name) {
  await button('文档与视图').click()
  await button(name, page.locator('.tool-menu-list')).click()
}

async function inspect(root, label, options = {}) {
  await root.locator('table').nth(2).waitFor({ state: 'attached' })
  const metrics = await root.evaluate(tableMetrics, { live: Boolean(options.live) })
  assertLayout(metrics, label, options)
}

async function exportDocument(format) {
  const filename = path.join(working, `${format}.${format === 'pdf' ? 'pdf' : 'html'}`)
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }) }, filename)
  await action('导出文档')
  await exportDialog.getByRole('combobox', { name: '格式' }).selectOption(format)
  await button('导出', exportDialog).click()
  const error = exportDialog.getByRole('alert')
  await Promise.race([exportDialog.waitFor({ state: 'hidden' }), error.waitFor()])
  if (await error.isVisible()) throw new Error(await error.textContent())
  return filename
}

async function printMetrics() {
  await app.evaluate(({ app }, measure) => {
    globalThis.sujianTablePrintMetrics = undefined
    app.once('browser-window-created', (_event, window) => {
      const print = window.webContents.printToPDF.bind(window.webContents)
      window.webContents.printToPDF = async (options) => {
        window.webContents.debugger.attach()
        try {
          await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' })
          globalThis.sujianTablePrintMetrics = await window.webContents.executeJavaScript(`(${measure})(document.querySelector('article'))`)
        } finally {
          window.webContents.debugger.detach()
        }
        return print(options)
      }
    })
  }, tableMetrics.toString())
}

try {
  await page.waitForSelector('.application[data-ready="true"]')
  await live.waitFor()
  await button('设置').click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await settings.getByLabel('文档宽度').press('Home')
  await button('关闭', settings).click()
  await page.waitForFunction(() => document.querySelector('.application')?.style.getPropertyValue('--document-width') === '520px')

  await check('Instant, 520px', () => inspect(live, 'Instant, 520px', { live: true, narrow: true }))
  await check('Navigate a wrapped cell', async () => {
    const row = live.getByRole('row').filter({ hasText: 'Sentence' })
    const content = row.getByRole('cell').nth(1)
    await content.click()
    const currentCell = () => page.evaluate(() => {
      const anchor = getSelection().anchorNode
      return (anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement)?.closest('td, th')?.cellIndex
    })
    assert.equal(await currentCell(), 1)
    await page.keyboard.press('Tab')
    assert.equal(await currentCell(), 2)
    await page.keyboard.press('Shift+Tab')
    assert.equal(await currentCell(), 1)
    console.log('Tab and Shift+Tab move between cells after wrapping.')
  })
  await button('设置').click()
  await settings.getByLabel('文档宽度').press('ArrowRight')
  await button('关闭', settings).click()
  await page.waitForFunction(() => document.querySelector('.application')?.style.getPropertyValue('--document-width') === '530px')
  await check('Instant, width updated', async () => {
    const tables = await live.evaluate(tableMetrics, { live: true })
    assert.ok(tables[0].available > 520 && tables[0].available <= 531)
    assertLayout(tables, 'Instant, width updated')
  })
  await button('设置').click()
  await settings.getByLabel('文档宽度').press('Home')
  await button('关闭', settings).click()
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1050, 850) })
  await action('分栏预览')
  await check('Split, narrow pane', () => inspect(preview, 'Split, narrow pane', { narrow: true }))
  await action('阅读模式')
  await check('Read, 520px', () => inspect(preview, 'Read, 520px', { narrow: true }))

  await check('Styled HTML', async () => {
    const filename = await exportDocument('html')
    const [exported] = await Promise.all([
      app.waitForEvent('window'),
      app.evaluate(async ({ BrowserWindow }, file) => {
        const window = new BrowserWindow({ show: false, width: 720, height: 800, webPreferences: { sandbox: true } })
        await window.loadFile(file)
      }, filename),
    ])
    try {
      await inspect(exported.locator('article'), 'Styled HTML')
    } finally {
      await exported.close()
    }
  })

  await check('Content-only HTML', async () => {
    const html = await readFile(await exportDocument('html-plain'), 'utf8')
    assert.equal(Array.from(html.matchAll(/<table(?:\s|>)/gi)).length, 3)
    for (const value of [identifier, url, code, heading]) assert.ok(html.includes(value))
    assert.doesNotMatch(html, /<style(?:\s|>)/i)
    console.log('Content-only HTML kept table structure and complete text.')
  })

  await check('PDF', async () => {
    await printMetrics()
    const filename = await exportDocument('pdf')
    const pdf = await readFile(filename)
    assert.ok(pdf.subarray(0, 5).equals(Buffer.from('%PDF-')))
    assert.ok(pdf.length > 5000)
    const tables = await app.evaluate(() => globalThis.sujianTablePrintMetrics)
    assertLayout(tables, 'PDF print layout')
  })

  await check('Review tables', async () => {
    await action('审阅修订稿')
    const review = page.getByRole('dialog', { name: '审阅修订稿', exact: true })
    await review.getByLabel('粘贴完整的 Markdown 修订稿').fill(source.replace('| Count | 12 |', '| Count | 13 |'))
    await button('比较修订稿', review).click()
    await button('排版预览', review).click()
    const rendered = review.locator('.review-rendered-content article')
    await inspect(rendered.first(), 'Review original')
    await inspect(rendered.last(), 'Review revision')
    await button('结束审阅', review).click()
  })

  await action('保存')
  assert.equal(await readFile(fixture, 'utf8'), source)
  if (failures.length) throw new Error(`Table layout checks failed: ${failures.join(', ')}`)
} finally {
  await app.close()
  console.log(`Table layout artifacts: ${working}`)
}

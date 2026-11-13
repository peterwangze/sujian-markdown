import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-content-width-'))
const fixture = path.join(working, '正文宽度.md')
const token = 'unbrokenIdentifier0123456789'.repeat(26)
const longUrl = 'https://example.invalid/' + token
const cells = Array.from({ length: 22 }, (_, index) => `Column ${index + 1}`)
const codeLine = `const widthProbe = "${token}";`
const formula = Array.from({ length: 55 }, (_, index) => `x_{${index + 1}}`).join('+')
const fraction = '\\frac{' + Array.from({ length: 36 }, (_, index) => `x_{${index + 1}}`).join('+') + '}{2}'
const wideTable = [
  `| ${cells.join(' | ')} |`,
  `| ${cells.map(() => '---').join(' | ')} |`,
  `| ${cells.map((_, index) => `Item ${index + 1}`).join(' | ')} |`,
].join('\n')
const source = [
  '# Width probe', `## Heading ${token}`, `Plain [${longUrl}](${longUrl}) after.`,
  `> Quote ${token} after.`, `- List ${token} after.`,
  `Keys <kbd>${token}</kbd> after.`,
  `~~~js\n${codeLine}\n~~~`, `<pre>Raw ${token}</pre>`, `$$\n${formula}\n$$`,
  `Inline $${fraction}$. `,
  `<details open><summary>Expand</summary>\n\nInside ${token} after.\n\n</details>`,
  '![Wide image](wide.svg)', '~~~dot\ndigraph { rankdir=LR; A -> B -> C -> D -> E -> F -> G -> H -> I -> J }\n~~~',
  wideTable, 'End of width probe.',
].join('\n\n') + '\n'
await Promise.all([
  writeFile(fixture, source),
  writeFile(path.join(working, 'wide.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="100"><rect width="1500" height="100" fill="#007f66"/></svg>'),
])

const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + path.join(working, 'profile')]
if (!executablePath) args.push(project)
args.push(fixture)
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(12000)
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const live = page.getByLabel('Markdown 即时编辑')
const preview = page.locator('.editor-preview article')
const failures = []

async function action(name) {
  await button('文档与视图').click()
  await button(name, page.locator('.tool-menu-list')).click()
}

async function check(name, task) {
  try {
    await task()
    console.log(name + ' passed.')
  } catch (error) {
    failures.push(name)
    console.error(name + ': ' + error.message)
  }
}

function layout(root) {
  const bounds = root.getBoundingClientRect()
  const style = getComputedStyle(root)
  const left = bounds.left + parseFloat(style.paddingLeft)
  const right = left + root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  const within = rect => rect.left >= left - 2 && rect.right <= right + 2
  const text = target => {
    const host = typeof target === 'string' ? root.querySelector(target) : target
    if (!host) return { lines: 0, within: false }
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    const rects = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest('.vditor-ir__marker')) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      rects.push(...Array.from(range.getClientRects()).filter(rect => rect.width > 0))
    }
    return { lines: new Set(rects.map(rect => Math.round(rect.top))).size, within: rects.every(within) }
  }
  const code = [...root.querySelectorAll('pre')].find(node => node.getBoundingClientRect().width && node.textContent.includes('widthProbe'))
  const raw = [...root.querySelectorAll('pre:not(.vditor-ir__preview)')].find(node => node.getBoundingClientRect().width && node.textContent.startsWith('Raw '))
  const math = root.querySelector('.katex-display')
  const inlineMath = root.querySelector('span.language-math:has(> .katex)')
  const image = root.querySelector('img[alt="Wide image"]')
  const diagram = root.querySelector('.markdown-diagram svg')
  const table = root.querySelector('table')
  return {
    available: Math.round(right - left),
    excess: root.scrollWidth - root.clientWidth,
    heading: text('h2'),
    link: text('p'),
    quote: text('blockquote'),
    list: text('li'),
    keys: text('kbd, [data-sujian-inline-html="kbd"]'),
    details: text([...root.querySelectorAll('p')].find(node => node.textContent.startsWith('Inside ')) ?? 'details > p'),
    code: Boolean(code && within(code.getBoundingClientRect())),
    raw: Boolean(raw && within(raw.getBoundingClientRect()) && raw.scrollWidth > raw.clientWidth),
    math: Boolean(math && within(math.getBoundingClientRect()) && math.scrollWidth > math.clientWidth),
    inlineMath: Boolean(inlineMath && within(inlineMath.getBoundingClientRect()) && inlineMath.scrollWidth > inlineMath.clientWidth),
    image: Boolean(image && image.naturalWidth === 1500 && within(image.getBoundingClientRect())),
    diagram: Boolean(diagram && within(diagram.getBoundingClientRect())),
    table: Boolean(table && within(table.getBoundingClientRect()) && table.scrollWidth > table.clientWidth),
  }
}

async function inspect(root, name) {
  await root.locator('.katex-display').first().waitFor()
  await root.locator('.markdown-diagram svg').first().waitFor()
  await root.locator('img[alt="Wide image"]').evaluate(image => image.decode())
  if (name === 'Instant') {
    const detail = root.locator('details > summary').first()
    await detail.click()
    await detail.click()
  }
  await root.locator('table').waitFor()
  await root.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const result = await root.evaluate(layout)
  for (const kind of ['heading', 'link', 'quote', 'list', 'keys', 'details']) {
    assert.ok(result[kind].within && result[kind].lines > 1, `${name} ${kind}: ${JSON.stringify(result)}`)
  }
  assert.ok(result.code, `${name} code escaped the document: ${JSON.stringify(result)}`)
  assert.ok(result.raw, `${name} raw pre escaped the document: ${JSON.stringify(result)}`)
  assert.ok(result.math && result.inlineMath, `${name} wide formula is not contained: ${JSON.stringify(result)}`)
  assert.ok(result.image && result.diagram, `${name} image or diagram escaped the document: ${JSON.stringify(result)}`)
  assert.ok(result.table, `${name} wide table is not contained: ${JSON.stringify(result)}`)
  assert.ok(result.excess <= 2, `${name} editor scrolls sideways: ${JSON.stringify(result)}`)
  const end = await root.locator('table').evaluate(table => {
    table.scrollLeft = table.scrollWidth
    const edge = table.getBoundingClientRect().right
    const cell = table.rows[1].cells[table.rows[1].cells.length - 1]
    const result = { text: cell.textContent, visible: cell.getBoundingClientRect().right <= edge + 2 }
    table.scrollLeft = 0
    return result
  })
  assert.deepEqual(end, { text: 'Item 22', visible: true })
}

try {
  await page.waitForSelector('.application[data-ready="true"]')
  await live.waitFor()
  await button('设置').click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await settings.getByLabel('文档宽度').press('Home')
  await button('关闭', settings).click()
  await page.waitForFunction(() => document.querySelector('.application')?.style.getPropertyValue('--document-width') === '520px')
  await check('Instant overflow containment', () => inspect(live, 'Instant'))

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1050, 850))
  await action('分栏预览')
  await check('Split overflow containment', () => inspect(preview, 'Split'))
  await action('阅读模式')
  await check('Reading overflow containment', () => inspect(preview, 'Read'))

  await check('Standalone HTML overflow containment', async () => {
    const output = path.join(working, '正文宽度.html')
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, output)
    await action('导出文档')
    const exportDialog = page.getByRole('dialog', { name: '导出文档', exact: true })
    await exportDialog.getByRole('combobox', { name: '格式' }).selectOption('html')
    await button('导出', exportDialog).click()
    await exportDialog.waitFor({ state: 'hidden' })
    const [standalone] = await Promise.all([
      app.waitForEvent('window'),
      app.evaluate(async ({ BrowserWindow }, file) => {
        const window = new BrowserWindow({ show: false, width: 620, height: 780, webPreferences: { sandbox: true } })
        await window.loadFile(file)
      }, output),
    ])
    try {
      await inspect(standalone.locator('article'), 'Standalone HTML')
    } finally {
      await standalone.close()
    }
  })
  await action('保存')
  assert.equal(await readFile(fixture, 'utf8'), source)
  await button('即时').click()
  const last = live.locator('table tbody tr').first().locator('td').last()
  await last.click()
  await last.evaluate(cell => getSelection().collapse(cell.firstChild, cell.firstChild.length))
  await page.keyboard.insertText(' verified')
  await action('保存')
  await page.getByRole('tab', { selected: true }).locator('[title="有未保存的改动"]').waitFor({ state: 'detached' })
  const saved = await readFile(fixture, 'utf8')
  const tableRow = saved.split('\n').find(line => line.startsWith('| Item 1'))
  assert.equal(tableRow?.split('|').map(cell => cell.trim()).filter(Boolean).at(-1), 'Item 22 verified')
  assert.equal(tableRow.split('|').filter(cell => cell.trim()).length, cells.length)
  await action('阅读模式')
  await preview.locator('table td').last().filter({ hasText: 'Item 22 verified' }).waitFor()
  assert.deepEqual(failures, [])
} finally {
  await app.close()
}

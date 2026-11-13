import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { _electron } from 'playwright'
import { waitForCheck } from './desktop-checks.mjs'

const run = promisify(execFile)
const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const working = await mkdtemp(path.join(tmpdir(), 'sujian-media-export-'))
const origin = path.join(working, '笔记')
const root = path.join(working, '站点')
const output = path.join(working, '导出')
const offline = path.join(working, '离线')
const profile = path.join(working, '配置')
const document = path.join(origin, '图文.md')
const draftPath = path.join(origin, '粘贴图片.md')
const missingDocument = path.join(origin, '缺图.md')
const mixedDocument = path.join(origin, '图片格式.md')
const imageFolder = '图文.assets'
const cases = [
  { alt: 'Encoded image', filename: '编码 图 100% #1.png', source: file => `![$](${path.relative(origin, file).split(path.sep).map(encodeURIComponent).join('/')})` },
  { alt: 'Bracket image', filename: '括号 图.png', source: '![$](<图文.assets/括号 图.png> "Bracket title")' },
  { alt: 'Reference image', filename: '引用 图.png', source: '![$][figure]', definition: '[figure]: <图文.assets/引用 图.png>' },
  { alt: 'HTML image', filename: 'HTML 图.png', source: '<img src="图文.assets/HTML 图.png" alt="$" width="31">' },
  { alt: 'Root image', filename: '根 图.png', root: true, source: '![$](</根 图.png>)' },
  { alt: 'Absolute image', filename: '绝对 图.png', source: filename => `![$](<${filename.split(path.sep).join('/')}>)` },
  { alt: 'File URL image', filename: 'URI 图.png', source: filename => `![$](${pathToFileURL(filename).href})` },
  { alt: 'HTML file URL image', filename: 'HTML URI.png', source: filename => `<img src="${pathToFileURL(filename).href}" alt="$">` },
].map((item, index) => ({
  ...item,
  width: 32 + index * 2,
  height: 26 + index * 2,
  color: [[23, 45, 199], [211, 38, 75], [37, 163, 67], [241, 107, 19], [103, 46, 161], [8, 154, 177], [213, 63, 159], [95, 86, 33]][index],
  file: path.join(item.root ? root : path.join(origin, imageFolder), item.filename),
}))
const formats = ['html', 'html-plain', 'pdf', 'png', 'docx', 'epub', 'odt', 'rtf', 'revealjs']
const extension = { 'html-plain': 'html', revealjs: 'html' }
const markdown = [
  '# Pictures', '', ...cases.flatMap(({ alt, source, file }) => [typeof source === 'function'
    ? source(file).replace('$', alt) : source.replace('$', alt), '']),
  ...cases.flatMap(({ definition }) => definition ? [definition] : []), '',
].join('\n')
await Promise.all([path.join(origin, imageFolder), root, output, offline, profile].map(directory => mkdir(directory, { recursive: true })))
await writeFile(document, markdown)
await writeFile(missingDocument, '# Missing\n\n![Missing image](不存在.png)\n')
await writeFile(path.join(profile, 'preferences.json'), JSON.stringify({ imageRoot: root, remoteMedia: false }))

const executablePath = process.env.SUJIAN_QA_EXE
const pandoc = process.env.SUJIAN_PANDOC ?? (executablePath
  ? path.join(path.dirname(executablePath), 'resources', 'pandoc', process.platform === 'win32' ? 'pandoc.exe' : 'pandoc')
  : path.join(project, 'build', 'pandoc', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'pandoc.exe' : 'pandoc'))
const args = ['--user-data-dir=' + profile]
if (!executablePath) args.push(project)
args.push(document)
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(15000)
const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
const nativeDialog = page.getByRole('dialog', { name: '导出文档', exact: true })
const failures = []
const payloads = new Map()

async function check(name, test) {
  try {
    await test()
    console.log(`${name} passed.`)
  } catch (error) {
    failures.push(name)
    console.error(`${name}: ${error.message.replace(/\s+/g, ' ').slice(0, 700)}`)
    if (await nativeDialog.isVisible()) await button('取消', nativeDialog).click()
  }
}

async function saveDestination(filePath) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, filePath)
}

async function action(name) {
  await button('文档与视图').click()
  await button(name, page.locator('.tool-menu-list')).click()
}

async function openDocument(filePath) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, filePath)
  await action('打开文件')
  await page.getByRole('tab', { name: path.basename(filePath), selected: true }).waitFor()
}

async function exportDocument(format, basename = format) {
  const destination = path.join(output, `${basename}.${extension[format] ?? format}`)
  await saveDestination(destination)
  await action('导出文档')
  await nativeDialog.getByRole('combobox', { name: '格式' }).selectOption(format)
  await button('导出', nativeDialog).click()
  const error = nativeDialog.getByRole('alert')
  await Promise.race([nativeDialog.waitFor({ state: 'hidden' }), error.waitFor()])
  if (await error.isVisible()) throw new Error(await error.textContent())
  return destination
}

async function makeImages() {
  const rendered = await app.evaluate(({ nativeImage }, cases) => cases.map(({ width, height, color }) => {
    const bgra = Buffer.alloc(width * height * 4)
    for (let offset = 0; offset < bgra.length; offset += 4) bgra.set([color[2], color[1], color[0], 255], offset)
    return nativeImage.createFromBitmap(bgra, { width, height }).toPNG().toString('base64')
  }), cases.map(({ width, height, color }) => ({ width, height, color })))
  await Promise.all(cases.map(({ alt, file }, index) => {
    const data = Buffer.from(rendered[index], 'base64')
    payloads.set(alt, data)
    return writeFile(file, data)
  }))
}

async function verifyHtml(file, expected) {
  const images = await app.evaluate(async ({ BrowserWindow, session }, filename) => {
    const isolated = session.fromPartition('media-export-offline')
    isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, decide) => decide({ cancel: true }))
    const window = new BrowserWindow({ show: false, webPreferences: { session: isolated, sandbox: true } })
    try {
      await window.loadFile(filename)
      return await window.webContents.executeJavaScript(`Promise.all([...document.images].map(async image => {
        await image.decode().catch(() => {})
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d')
        let color = []
        try {
          context.drawImage(image, 0, 0, 1, 1)
          color = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
        } catch {}
        return { alt: image.alt, src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight, color }
      }))`)
    } finally {
      window.destroy()
    }
  }, file)
  const found = new Map(images.map(image => [image.alt, image]))
  const failed = expected.filter(({ alt, width, height, color }) => {
    const image = found.get(alt)
    return !image || image.width !== width || image.height !== height || image.color.join() !== color.join() ||
      !/^data:image\/png[;,]/i.test(image.src)
  }).map(({ alt }) => ({ alt, result: found.get(alt) }))
  assert.equal(failed.length, 0, JSON.stringify(failed))
}

async function verifyPng(file, expected) {
  const counts = await app.evaluate(({ nativeImage }, { file, expected }) => {
    const bitmap = nativeImage.createFromPath(file).toBitmap()
    return expected.map(({ color }) => {
      let count = 0
      for (let offset = 0; offset < bitmap.length; offset += 4) {
        if (bitmap[offset + 2] === color[0] && bitmap[offset + 1] === color[1] && bitmap[offset] === color[2]) count++
      }
      return count
    })
  }, { file, expected: expected.map(({ color }) => ({ color })) })
  assert.deepEqual(expected.filter((_, index) => counts[index] < 20).map(item => item.alt), [])
}

async function verifyPdf(file, expected) {
  const pdf = await readFile(file, 'latin1')
  assert.ok(pdf.startsWith('%PDF-'))
  const images = [...pdf.matchAll(/\/Subtype\s*\/Image\b[^>]*?\/Width\s+(\d+)[^>]*?\/Height\s+(\d+)/g)]
    .map(([, width, height]) => `${width}x${height}`)
  assert.deepEqual(expected.filter(({ width, height }) => !images.includes(`${width}x${height}`)).map(item => item.alt), [])
}

async function verifyContainer(file, format, expected) {
  const extracted = path.join(working, `${path.parse(file).name}-images`)
  const { stdout } = await run(pandoc, ['--from', format, '--to', 'html', `--extract-media=${extracted}`, file], { cwd: offline })
  const media = await readdir(extracted, { recursive: true, withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const bytes = await Promise.all(media.filter(item => item.isFile()).map(item => readFile(path.join(item.parentPath, item.name))))
  const alts = await page.evaluate(html => [...new DOMParser().parseFromString(html, 'text/html').images].map(image => image.alt), stdout)
  const missing = expected.filter(({ alt }) => !bytes.some(data => data.equals(payloads.get(alt)))).map(({ alt }) => alt)
  assert.deepEqual(missing, [], `${format} missing pixel data; image labels: ${alts.join(', ')}`)
  assert.equal(alts.length, expected.length)
  if (format !== 'odt') assert.deepEqual(alts.toSorted(), expected.map(item => item.alt).sort())
}

async function verifyRtf(file, expected) {
  const rtf = await readFile(file, 'utf8')
  assert.ok(rtf.startsWith('{\\rtf'))
  const pixels = rtf.replace(/\s/g, '').toLowerCase()
  assert.deepEqual(expected.filter(({ alt }) => !pixels.includes(payloads.get(alt).toString('hex'))).map(item => item.alt), [])
}

async function makeMixedImages() {
  const vector = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="28"><rect width="36" height="28" fill="#2b44ce"/></svg>'
  const webp = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 41
    canvas.height = 30
    const context = canvas.getContext('2d')
    context.fillStyle = '#d4316d'
    context.fillRect(0, 0, 41, 30)
    return canvas.toDataURL('image/webp').split(',')[1]
  })
  await Promise.all([
    writeFile(path.join(origin, '矢量 图.svg'), vector),
    writeFile(path.join(origin, '现代 图.webp'), Buffer.from(webp, 'base64')),
    writeFile(mixedDocument, '# Mixed image formats\n\n<img src="矢量 图.svg" alt="Vector image">\n\n![WebP image](<现代 图.webp>)\n'),
  ])
}

async function verifyWordFallbackImages(file) {
  const extracted = path.join(working, 'compatibility-image-media')
  const { stdout } = await run(pandoc, ['--from', 'docx', '--to', 'html', `--extract-media=${extracted}`, file], { cwd: offline })
  const media = (await readdir(extracted, { recursive: true, withFileTypes: true })).filter(item => item.isFile())
  assert.equal(media.length, 2)
  const dimensions = await Promise.all(media.map(async item => {
    const png = await readFile(path.join(item.parentPath, item.name))
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`
  }))
  assert.deepEqual(dimensions.toSorted(), ['36x28', '41x30'])
  const labels = await page.evaluate(html => [...new DOMParser().parseFromString(html, 'text/html').images].map(image => image.alt), stdout)
  assert.deepEqual(labels, ['Vector image', 'WebP image'])
}

async function verifyRtfFallbackImages(file) {
  const rtf = await readFile(file, 'utf8')
  const dimensions = [...rtf.matchAll(/\\pngblip[^}]*?\s+(89504e470d0a1a0a[\da-f\s]+)/gi)]
    .map(([, hex]) => Buffer.from(hex.replace(/\s/g, ''), 'hex'))
    .map(png => `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`)
  assert.deepEqual(dimensions.toSorted(), ['36x28', '41x30'])
}

async function verifyPreview(preview) {
  await preview.getByText('Pictures', { exact: true }).waitFor()
  const actual = await preview.locator('img').evaluateAll(async images => {
    await Promise.all(images.map(image => image.decode().catch(() => {})))
    return Object.fromEntries(images.map(image => [image.alt, image.naturalWidth]))
  })
  assert.deepEqual(cases.filter(({ alt, width }) => actual[alt] !== width).map(({ alt }) => ({ alt, width: actual[alt] })), [])
}

try {
  await page.waitForSelector('.application[data-ready="true"]')
  await makeImages()
  await action('分栏预览')
  const preview = page.locator('.editor-preview')
  await check('Split preview images', () => verifyPreview(preview))
  await action('阅读模式')
  await check('Reading view images', () => verifyPreview(preview))

  const files = new Map()
  for (const format of formats) {
    await check(`Export ${format}`, async () => files.set(format, await exportDocument(format)))
  }

  await check('Print preview has decoded images', async () => {
    await app.evaluate(({ app }) => {
      app.once('browser-window-created', (_event, window) => {
        window.webContents.print = async (_options, done) => {
          globalThis.printedImages = await window.webContents.executeJavaScript(
            'Object.fromEntries([...document.images].map(image => [image.alt, image.naturalWidth]))',
          )
          done(false, 'Print job canceled')
        }
      })
    })
    await action('打印')
    let images
    await waitForCheck('Expected the native print boundary', async () => (images = await app.evaluate(() => globalThis.printedImages)))
    assert.deepEqual(cases.filter(({ alt, width }) => images[alt] !== width).map(item => item.alt), [])
  })

  const encoded = cases[0]
  const draftImage = { ...encoded, alt: 'Pasted picture' }
  await action('新建文档')
  await button('源码').click()
  const source = page.getByLabel('Markdown 源码')
  await source.evaluate((editor, base64) => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], 'Pasted picture.png', { type: 'image/png' }))
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, payloads.get(encoded.alt).toString('base64'))
  await source.getByText(/Pasted picture/).first().waitFor()
  payloads.set(draftImage.alt, payloads.get(encoded.alt))
  await check('Export unsaved pasted image', async () => files.set('draft', await exportDocument('html', 'draft')))
  await check('Export unsaved pasted image to Word', async () => files.set('draft-word', await exportDocument('docx', 'draft-word')))
  await saveDestination(draftPath)
  await action('另存为')
  await page.getByRole('tab', { name: '粘贴图片.md', selected: true }).waitFor()
  await check('Export saved pasted image', async () => files.set('saved-draft', await exportDocument('docx', 'saved-draft')))

  await openDocument(missingDocument)
  for (const format of ['html', 'docx']) {
    await check(`Missing image notice in ${format}`, async () => {
      await exportDocument(format, `missing-${format}`)
      const warning = page.getByRole('alert').filter({ hasText: /1 处本地资源无法内嵌/ })
      await warning.waitFor({ timeout: 2500 })
    })
  }
  await makeMixedImages()
  await openDocument(mixedDocument)
  for (const format of ['docx', 'rtf']) {
    await check(`Export SVG and WebP to ${format}`, async () => {
      files.set(`fallback-${format}`, await exportDocument(format, `fallback-${format}`))
    })
  }

  assert.equal(await readFile(document, 'utf8'), markdown)
  for (const directory of [origin, root]) await rename(directory, `${directory}-removed`)
  const draftAssets = path.join(profile, 'assets')
  await rename(draftAssets, `${draftAssets}-removed`).catch(error => {
    if (error.code !== 'ENOENT') throw error
  })
  for (const [format, file] of files) {
    await check(`Offline image content ${format}`, async () => {
      const moved = path.join(offline, path.basename(file))
      await copyFile(file, moved)
      if (['html', 'html-plain', 'revealjs', 'draft'].includes(format)) await verifyHtml(moved, format === 'draft' ? [draftImage] : cases)
      else if (format === 'png') await verifyPng(moved, cases)
      else if (format === 'pdf') await verifyPdf(moved, cases)
      else if (format === 'rtf') await verifyRtf(moved, cases)
      else if (format === 'fallback-docx') await verifyWordFallbackImages(moved)
      else if (format === 'fallback-rtf') await verifyRtfFallbackImages(moved)
      else if (format === 'saved-draft' || format === 'draft-word') await verifyContainer(moved, 'docx', [draftImage])
      else await verifyContainer(moved, format, cases)
    })
  }
  if (failures.length) {
    console.error(`${failures.length} media export checks failed: ${failures.join(', ')}`)
    process.exitCode = 1
  }
} finally {
  await app.close()
  console.log(`Media export artifacts: ${working}`)
}

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const { version, homepage } = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'))
const [major, minor, patch] = version.split('.').map(Number)
const nextVersion = `${major}.${minor}.${patch + 1}`
const latestUrl = `https://api.github.com/repos${new URL(homepage).pathname}/releases/latest`
const releaseNote = '支持从应用内查看版本说明并安全保存离线安装包。'
const body = '## 版本亮点\n\n- ' + releaseNote + '\n- 改进长文档编辑时的交互体验。'
const installerBytes = Buffer.alloc(16 * 1024 * 1024, 0x73)
const digest = createHash('sha256').update(installerBytes).digest('hex')
const installerSuffixes = {
  'win32:x64': ['win-x64.exe'],
  'win32:arm64': ['win-arm64.exe'],
  'darwin:x64': ['mac-x64.dmg'],
  'darwin:arm64': ['mac-arm64.dmg'],
  'linux:x64': ['linux-x86_64.AppImage', 'linux-amd64.deb'],
  'linux:arm64': ['linux-arm64.AppImage', 'linux-arm64.deb'],
}

function release(versionNumber) {
  const tag = 'v' + versionNumber
  const assets = Object.values(installerSuffixes).flat().map(suffix => {
    const name = `Sujian-${versionNumber}-${suffix}`
    return {
      name, size: installerBytes.length, state: 'uploaded', digest: 'sha256:' + digest,
      browser_download_url: `${homepage}/releases/download/${tag}/${name}`,
    }
  })
  return {
    tag_name: tag, name: 'Sujian ' + tag, draft: false, prerelease: false, body,
    html_url: `${homepage}/releases/tag/${tag}`, published_at: '2026-11-16T02:00:00Z', assets,
  }
}

const currentRelease = release(version)
const nextRelease = release(nextVersion)
const working = await mkdtemp(path.join(process.env.SUJIAN_UPDATE_TEST_ROOT || tmpdir(), 'sujian-updates-'))
const profile = path.join(working, 'profile')
const downloads = path.join(working, 'downloads')
const originalDocument = path.join(working, '升级演示.md')
const newDocument = path.join(working, '保留的新稿.md')
const secondDocument = path.join(working, '另一个窗口.md')
const originalText = '# 升级演示\n\n这份文档用于核对升级前的保存。\n'
const secondText = '# 另一个窗口\n'
const editedLine = '这段修改需要先保存。'
const retryLine = '重试安装前的最后一次修改。'
const newDraft = '新稿也需要在打开安装器前保存。'
const secondEdit = '另一扇窗口里的修改也要保存。'
await Promise.all([mkdir(profile), mkdir(downloads)])
await Promise.all([
  writeFile(originalDocument, originalText),
  writeFile(secondDocument, secondText),
  writeFile(path.join(profile, 'preferences.json'), JSON.stringify({ mode: 'source', autoSave: false, resume: false })),
])
const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + profile, ...(executablePath ? [] : [project]), originalDocument]
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(12000)
const about = page.getByRole('dialog', { name: '关于素笺', exact: true })
const button = name => about.getByRole('button', { name, exact: true })
const versionButton = page.getByRole('button', { name: `关于素笺，当前版本 v${version}`, exact: true })
const source = page.getByLabel('Markdown 源码')
const sourceLine = text => source.locator('.cm-line').getByText(text, { exact: true })
const installButton = button('安装更新')
const savePrompt = window => window.getByRole('dialog', { name: '安装前保存文档', exact: true })

async function documentAction(window, name) {
  await window.getByRole('button', { name: '文档与视图', exact: true }).click()
  await window.locator('.tool-menu-list').getByRole('button', { name, exact: true }).click()
}

async function appendSource(window, line) {
  const editor = window.getByLabel('Markdown 源码')
  await editor.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await window.keyboard.press('Enter')
  await window.keyboard.insertText(line)
  await window.keyboard.press('Enter')
  await editor.locator('.cm-line').getByText(line, { exact: true }).waitFor()
}

async function verifyWindowsInstallation(network, destination, downloadButton) {
  await installButton.waitFor()
  if (process.env.SUJIAN_INSTALL_SCREENSHOT) await about.screenshot({ path: process.env.SUJIAN_INSTALL_SCREENSHOT })

  const modified = Buffer.from(installerBytes)
  modified[0] ^= 1
  await writeFile(destination, modified)
  await installButton.click()
  await about.getByRole('alert').filter({ hasText: '安装包已被修改或替换，请重新下载。' }).waitFor()
  assert.equal(await network.evaluate(state => state.installCalls.length), 0)
  await unlink(destination)
  await downloadButton.click()
  await installButton.waitFor()
  assert.deepEqual(await readFile(destination), installerBytes)

  await button('关闭').click()
  await page.getByRole('tab').filter({ hasText: path.basename(originalDocument) }).click()
  await appendSource(page, editedLine)
  await page.getByRole('button', { name: '新建文档', exact: true }).click()
  await page.getByRole('tab', { selected: true }).filter({ hasText: '未命名.md' }).waitFor()
  await source.focus()
  await page.keyboard.insertText(newDraft)
  await sourceLine(newDraft).waitFor()

  const opened = app.waitForEvent('window')
  await documentAction(page, '新建窗口')
  const other = await opened
  await other.waitForSelector('.application[data-ready="true"]')
  await documentAction(other, '打开文件')
  await other.getByRole('tab', { selected: true }).filter({ hasText: path.basename(secondDocument) }).waitFor()
  await appendSource(other, secondEdit)

  await versionButton.click()
  const confirm = savePrompt(page)
  const otherConfirm = savePrompt(other)
  const saveAndInstall = scope => scope.getByRole('button', { name: '保存并安装', exact: true })
  const cancelled = about.getByText('已取消安装', { exact: false })
  await installButton.click()
  await confirm.getByText(path.basename(originalDocument), { exact: true }).waitFor()
  await confirm.getByText('未命名.md', { exact: true }).waitFor()
  assert.equal(await otherConfirm.count(), 0)
  const cancel = confirm.getByRole('button', { name: '取消', exact: true })
  assert.equal(await cancel.evaluate(element => element === document.activeElement), true)
  if (process.env.SUJIAN_INSTALL_PROMPT_SCREENSHOT) {
    await confirm.screenshot({ path: process.env.SUJIAN_INSTALL_PROMPT_SCREENSHOT })
  }
  await cancel.click()
  await cancelled.waitFor()
  assert.equal(await readFile(originalDocument, 'utf8'), originalText)
  assert.equal(await readFile(secondDocument, 'utf8'), secondText)
  assert.equal(await network.evaluate(state => state.saveCalls), 0)
  assert.equal(await network.evaluate(state => state.installCalls.length), 0)

  await installButton.click()
  await saveAndInstall(confirm).click()
  await cancelled.waitFor()
  assert.equal(await network.evaluate(state => state.saveCalls), 1)
  assert.equal(await network.evaluate(state => state.installCalls.length), 0)
  assert.equal(await network.evaluate(state => state.quitCalls), 0)
  assert.equal(await otherConfirm.count(), 0)
  await assert.rejects(readFile(newDocument), { code: 'ENOENT' })

  await button('关闭').click()
  await sourceLine(newDraft).waitFor()
  await page.getByRole('tab').filter({ hasText: path.basename(originalDocument) }).click()
  await sourceLine(editedLine).waitFor()
  await appendSource(page, retryLine)
  await network.evaluate(state => { state.cancelSave = false })
  await versionButton.click()
  await installButton.click()
  await saveAndInstall(confirm).click()
  await otherConfirm.getByText(path.basename(secondDocument), { exact: true }).waitFor()
  await page.getByRole('dialog', { name: '准备安装更新', exact: true })
    .getByText('文档已准备就绪，等待启动安装。', { exact: true }).waitFor()
  assert.equal(await network.evaluate(state => state.installCalls.length), 0)
  assert.equal(await readFile(newDocument, 'utf8'), newDraft)
  await saveAndInstall(otherConfirm).click()
  assert.deepEqual(await network.evaluate(state => state.waitForInstallation()), {
    file: destination,
    original: originalText + '\n' + editedLine + '\n\n' + retryLine + '\n',
    newDocument: newDraft,
    second: secondText + '\n' + secondEdit + '\n',
  })
  assert.equal(await network.evaluate(state => state.waitForQuit()), true)
  console.log('Windows installation rejects a modified download, honors confirmation and Save As cancellations, and saves all windows before opening the verified installer.')
}

try {
  const runtime = await app.evaluate(({ app: nativeApp }) => ({
    platform: process.platform, arch: nativeApp.runningUnderARM64Translation ? 'arm64' : process.arch,
    version: nativeApp.getVersion(),
  }))
  assert.equal(runtime.version, version)
  const suffixes = installerSuffixes[`${runtime.platform}:${runtime.arch}`]
  assert.ok(suffixes, `Unsupported desktop QA target ${runtime.platform}/${runtime.arch}`)
  const installerName = `Sujian-${nextVersion}-${suffixes[0]}`
  const installer = nextRelease.assets.find(asset => asset.name === installerName)
  const incompatibleAssets = nextRelease.assets.filter(asset => !suffixes.some(suffix => asset.name.endsWith(suffix)))
  const redirectedInstaller = 'https://release-assets.githubusercontent.com/sujian-qa/' + installerName
  const destination = path.join(downloads, installerName)
  const downloadButton = button(runtime.platform === 'linux' ? '下载 AppImage' : '下载安装包')

  const network = await app.evaluateHandle(({ app: nativeApp, dialog, net, session, shell }, fixture) => {
    nativeApp.setPath('downloads', fixture.downloads)
    const { EventEmitter } = process.getBuiltinModule('node:events')
    const { readFileSync } = process.getBuiltinModule('node:fs')
    const { PassThrough, Readable } = process.getBuiltinModule('node:stream')
    const originalRequest = net.request
    const originalOpenPath = shell.openPath
    const originalReveal = shell.showItemInFolder
    const originalSave = dialog.showSaveDialog
    const originalOpen = dialog.showOpenDialog
    const originalQuit = nativeApp.quit
    const state = {
      mode: 'current', requests: [], chromiumRequests: [], reveals: [], installCalls: [],
      saveCalls: 0, quitCalls: 0, cancelSave: true,
    }
    const waitFor = promise => Promise.race([promise, new Promise(resolve => setTimeout(resolve, 5000, null).unref())])
    const checkGate = new Promise(resolve => { state.finishCheck = resolve })
    let startTransfer
    const transfer = new Promise(resolve => { startTransfer = resolve })
    const reveal = new Promise(resolve => {
      shell.showItemInFolder = file => {
        state.reveals.push(file)
        resolve(file)
      }
    })
    const readDocument = file => {
      try {
        return readFileSync(file, 'utf8')
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    }
    const installation = new Promise(resolve => {
      shell.openPath = async file => {
        const invocation = {
          file, original: readDocument(fixture.originalDocument), newDocument: readDocument(fixture.newDocument),
          second: readDocument(fixture.secondDocument),
        }
        state.installCalls.push(invocation)
        resolve(invocation)
        return ''
      }
    })
    dialog.showSaveDialog = async () => {
      state.saveCalls++
      return state.cancelSave ? { canceled: true } : { canceled: false, filePath: fixture.newDocument }
    }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture.secondDocument] })
    const quit = new Promise(resolve => {
      nativeApp.quit = () => {
        state.quitCalls++
        resolve(true)
      }
    })
    state.waitForReveal = () => waitFor(reveal)
    state.waitForTransfer = () => waitFor(transfer)
    state.waitForInstallation = () => waitFor(installation)
    state.waitForQuit = () => waitFor(quit)
    net.request = options => {
      const url = typeof options === 'string' ? options : options.url
      if (!/^https?:\/\//.test(url)) return originalRequest.call(net, options)
      state.chromiumRequests.push({
        defaultSession: options.session ? options.session === session.defaultSession : !options.partition,
        redirect: options.redirect,
      })
      const request = new EventEmitter()
      let closed = false
      let response
      const close = () => {
        if (closed) return
        closed = true
        request.emit('close')
      }
      const reply = (statusCode, bytes, contentType, hold = false) => {
        if (closed) return
        response = Object.assign(hold ? new PassThrough() : Readable.from([bytes]), {
          statusCode,
          headers: { 'content-type': [contentType], 'content-length': [String(bytes.length)] },
        })
        response.once('end', close)
        response.once('close', close)
        request.emit('response', response)
        if (hold) {
          response.write(bytes.subarray(0, 32 * 1024))
          startTransfer(true)
        }
      }
      request.setHeader = () => {}
      request.abort = () => {
        if (closed) return
        closed = true
        request.emit('abort')
        response?.emit('aborted')
        response?.destroy()
        request.emit('close')
      }
      const deliver = async address => {
        if (closed) return
        state.requests.push(address)
        if (address === fixture.latest) {
          if (state.mode === 'offline') throw new Error('net::ERR_INTERNET_DISCONNECTED')
          const release = state.mode === 'current' ? await checkGate.then(() => fixture.current) : fixture.next
          const assets = state.mode === 'incompatible' ? fixture.incompatibleAssets : release.assets
          reply(200, Buffer.from(JSON.stringify({ ...release, assets })), 'application/json')
        } else if (address === fixture.installer) {
          request.emit('redirect', 302, 'GET', fixture.redirectedInstaller, { location: [fixture.redirectedInstaller] })
          if (!closed) {
            request.emit('error', new Error('net::ERR_ABORTED'))
            close()
          }
        } else if (address === fixture.redirectedInstaller) {
          const bytes = Buffer.alloc(fixture.installerSize, 0x73)
          if (state.mode === 'corrupt') bytes[0] ^= 1
          reply(200, bytes, 'application/octet-stream', state.mode === 'held')
        } else {
          reply(404, Buffer.alloc(0), 'text/plain')
        }
      }
      request.end = () => queueMicrotask(() => {
        void deliver(url).catch(error => {
          if (!closed) request.emit('error', error)
          close()
        })
      })
      return request
    }
    state.restore = () => {
      net.request = originalRequest
      shell.openPath = originalOpenPath
      shell.showItemInFolder = originalReveal
      dialog.showSaveDialog = originalSave
      dialog.showOpenDialog = originalOpen
      nativeApp.quit = originalQuit
    }
    return state
  }, {
    downloads, originalDocument, newDocument, secondDocument, latest: latestUrl,
    current: currentRelease, next: nextRelease, incompatibleAssets,
    installer: installer.browser_download_url, redirectedInstaller, installerSize: installerBytes.length,
  })
  const setMode = mode => network.evaluate((state, next) => { state.mode = next }, mode)
  try {
    await page.waitForSelector('.application[data-ready="true"]')
    await versionButton.click()
    const check = button('检查更新')
    await check.click()
    await about.getByText('正在检查更新…', { exact: true }).waitFor()
    assert.equal(await check.isDisabled(), true)
    await network.evaluate(state => state.finishCheck())
    await about.getByText('当前已是最新版', { exact: false }).waitFor()
    assert.equal(await downloadButton.count(), 0)
    assert.deepEqual(await readdir(downloads), [])

    await setMode('offline')
    await check.click()
    const error = about.getByRole('alert')
    await error.waitFor()
    assert.match(await error.textContent(), /无法连接 GitHub.*系统代理/)
    assert.equal(await downloadButton.count(), 0)

    await setMode('incompatible')
    await check.click()
    await about.getByText('这个版本暂时没有适合当前设备的安装包。', { exact: true }).waitFor()
    assert.equal(await downloadButton.count(), 0)
    await button('查看发布记录').waitFor()

    await setMode('newer')
    await check.click()
    await about.getByText(`发现新版 v${nextVersion}`, { exact: true }).waitFor()
    await about.getByText('更新内容', { exact: true }).waitFor()
    await about.getByText(releaseNote, { exact: false }).waitFor()
    await about.getByText(installerName, { exact: false }).waitFor()
    assert.equal(await installButton.count(), 0)
    for (const asset of incompatibleAssets) {
      assert.equal(await about.getByText(asset.name, { exact: false }).count(), 0)
    }
    if (process.env.SUJIAN_UPDATE_SCREENSHOT) {
      await about.screenshot({ path: process.env.SUJIAN_UPDATE_SCREENSHOT })
    }
    console.log('About checked current and newer versions, retried after an offline error, and displayed notes and matching installers.')

    await setMode('held')
    await downloadButton.click()
    assert.equal(await network.evaluate(state => state.waitForTransfer()), true)
    assert.match((await readdir(downloads)).join('\n'), /^Sujian-download-/)
    await about.getByRole('progressbar', { name: '下载进度', exact: true }).waitFor()
    assert.equal(await check.isDisabled(), true)
    await button('取消下载').click()
    await about.getByText('已取消下载', { exact: true }).waitFor()
    assert.deepEqual(await readdir(downloads), [])
    assert.equal(await installButton.count(), 0)

    await setMode('corrupt')
    await downloadButton.click()
    await error.waitFor()
    assert.match(await error.textContent(), /SHA-256|校验/)
    assert.deepEqual(await readdir(downloads), [])
    assert.equal(await installButton.count(), 0)

    await setMode('newer')
    await downloadButton.click()
    await about.getByText('已下载并通过校验', { exact: false }).waitFor()
    assert.deepEqual(await readdir(downloads), [installerName])
    assert.deepEqual(await readFile(destination), installerBytes)
    const downloadRequests = await network.evaluate((state, latest) => state.requests.filter(url => url !== latest), latestUrl)
    const downloadRoute = [installer.browser_download_url, redirectedInstaller]
    assert.deepEqual(downloadRequests, [...downloadRoute, ...downloadRoute, ...downloadRoute])
    const chromiumRequests = await network.evaluate(state => state.chromiumRequests)
    assert.equal(chromiumRequests.length, 4 + downloadRequests.length)
    assert.equal(chromiumRequests.every(request => request.defaultSession && request.redirect === 'manual'), true)
    assert.deepEqual(await network.evaluate(state => state.reveals), [])
    await button('打开下载位置').click()
    assert.equal(await network.evaluate(state => state.waitForReveal()), destination)
    console.log('Installer downloads clean up staging after cancel or bad checksum, save verified bytes, and reveal the destination on request.')
    if (runtime.platform === 'win32') await verifyWindowsInstallation(network, destination, downloadButton)
  } finally {
    await network.evaluate(state => state.restore())
    await network.dispose()
  }
} finally {
  await app.close()
}

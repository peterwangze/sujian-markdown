import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises'
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
await Promise.all([mkdir(profile), mkdir(downloads)])
const executablePath = process.env.SUJIAN_QA_EXE
const args = ['--user-data-dir=' + profile, ...(executablePath ? [] : [project])]
const app = await _electron.launch({ args, ...(executablePath && { executablePath }) })
const page = await app.firstWindow()
page.setDefaultTimeout(12000)
const about = page.getByRole('dialog', { name: '关于素笺', exact: true })
const button = name => about.getByRole('button', { name, exact: true })

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

  const network = await app.evaluateHandle(({ app: nativeApp, shell }, fixture) => {
    nativeApp.setPath('downloads', fixture.downloads)
    const originalFetch = globalThis.fetch
    const originalOpenPath = shell.openPath
    const originalReveal = shell.showItemInFolder
    const state = { mode: 'current', requests: [], reveals: [] }
    const waitFor = promise => Promise.race([promise, new Promise(resolve => setTimeout(resolve, 5000, null).unref())])
    const checkGate = new Promise(resolve => { state.finishCheck = resolve })
    let startTransfer
    const transfer = new Promise(resolve => { startTransfer = resolve })
    const reveal = new Promise(resolve => {
      const capture = file => {
        state.reveals.push(file)
        resolve(file)
      }
      shell.openPath = async file => {
        capture(file)
        return ''
      }
      shell.showItemInFolder = capture
    })
    state.waitForReveal = () => waitFor(reveal)
    state.waitForTransfer = () => waitFor(transfer)
    globalThis.fetch = async (address, options) => {
      const url = typeof address === 'string' ? address : address.url ?? address.href
      if (!/^https?:\/\//.test(url)) return originalFetch(address, options)
      state.requests.push(url)
      if (url === fixture.latest) {
        if (state.mode === 'offline') throw new TypeError('net::ERR_INTERNET_DISCONNECTED')
        if (state.mode === 'current') {
          await checkGate
          return Response.json(fixture.current)
        }
        if (state.mode === 'incompatible') return Response.json({ ...fixture.next, assets: fixture.incompatibleAssets })
        return Response.json(fixture.next)
      }
      if (url === fixture.installer) {
        return Response.redirect(fixture.redirectedInstaller, 302)
      }
      if (url === fixture.redirectedInstaller) {
        const bytes = Buffer.alloc(fixture.installerSize, 0x73)
        if (state.mode === 'corrupt') bytes[0] ^= 1
        const data = state.mode === 'held' ? new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.subarray(0, 32 * 1024))
            startTransfer(true)
          },
        }) : bytes
        const headers = { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) }
        return new Response(data, { headers })
      }
      return new Response(null, { status: 404 })
    }
    state.restore = () => {
      globalThis.fetch = originalFetch
      shell.openPath = originalOpenPath
      shell.showItemInFolder = originalReveal
    }
    return state
  }, {
    downloads, latest: latestUrl, current: currentRelease, next: nextRelease, incompatibleAssets,
    installer: installer.browser_download_url, redirectedInstaller, installerSize: installerBytes.length,
  })
  const setMode = mode => network.evaluate((state, next) => { state.mode = next }, mode)
  try {
    await page.waitForSelector('.application[data-ready="true"]')
    await page.getByRole('button', { name: `关于素笺，当前版本 v${version}`, exact: true }).click()
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
    assert.match(await error.textContent(), /检查更新|网络|离线/)
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

    await setMode('corrupt')
    await downloadButton.click()
    await error.waitFor()
    assert.match(await error.textContent(), /SHA-256|校验/)
    assert.deepEqual(await readdir(downloads), [])

    await setMode('newer')
    await downloadButton.click()
    await about.getByText('已下载并通过校验', { exact: false }).waitFor()
    assert.deepEqual(await readdir(downloads), [installerName])
    assert.deepEqual(await readFile(destination), installerBytes)
    const downloadRequests = await network.evaluate((state, latest) => state.requests.filter(url => url !== latest), latestUrl)
    const downloadRoute = [installer.browser_download_url, redirectedInstaller]
    assert.deepEqual(downloadRequests, [...downloadRoute, ...downloadRoute, ...downloadRoute])
    assert.deepEqual(await network.evaluate(state => state.reveals), [])
    await button('打开下载位置').click()
    assert.equal(await network.evaluate(state => state.waitForReveal()), destination)
    console.log('Installer downloads clean up staging after cancel or bad checksum, save verified bytes, and reveal the destination on request.')
  } finally {
    await network.evaluate(state => state.restore())
    await network.dispose()
  }
} finally {
  await app.close()
}

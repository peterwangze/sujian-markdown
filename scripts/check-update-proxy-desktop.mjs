import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, X509Certificate } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { _electron } from 'playwright'

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const { version, homepage } = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'))
const [major, minor, patch] = version.split('.').map(Number)
const newer = `${major}.${minor}.${patch + 1}`
const latestUrl = new URL(`https://api.github.com/repos${new URL(homepage).pathname}/releases/latest`)
const assetHost = 'release-assets.githubusercontent.com'
const allowedHosts = new Set([latestUrl.hostname, new URL(homepage).hostname, assetHost])
const root = await mkdtemp(path.join(process.env.SUJIAN_UPDATE_TEST_ROOT || tmpdir(), 'sujian-proxy-'))
const downloads = path.join(root, 'downloads')
const profile = path.join(root, 'profile')
await Promise.all([mkdir(downloads), mkdir(profile)])
const certPath = path.join(root, 'fixture-cert.pem')
const keyPath = path.join(root, 'fixture-key.pem')
const opensslConfig = path.join(root, 'openssl.cnf')
await writeFile(opensslConfig, [
  '[req]', 'distinguished_name = test_subject', 'x509_extensions = test_extensions', 'prompt = no',
  '[test_subject]', 'CN = api.github.com', '[test_extensions]', 'extendedKeyUsage = serverAuth',
  'subjectAltName = ' + [...allowedHosts].map(host => 'DNS:' + host).join(','), '',
].join('\n'))
try {
  await promisify(execFile)('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-sha256', '-config', opensslConfig,
    '-keyout', keyPath, '-out', certPath,
  ], { windowsHide: true })
} catch (error) {
  if (error.code === 'ENOENT') throw new Error('This optional proxy check requires the OpenSSL CLI.', { cause: error })
  throw error
}
const [cert, key] = await Promise.all([readFile(certPath), readFile(keyPath)])
const fingerprint = new X509Certificate(cert).fingerprint256
const requestPaths = []
const tunnels = []
let fixture
const contents = Buffer.alloc(2 * 1024 * 1024, 0x51)
const checksum = createHash('sha256').update(contents).digest('hex')

const origin = createHttpsServer({ cert, key }, (request, response) => {
  const address = `https://${request.headers.host}${request.url}`
  requestPaths.push(address)
  if (address === latestUrl.href) {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(fixture.info))
  } else if (address === fixture.assetUrl) {
    response.writeHead(302, { location: fixture.redirectUrl })
    response.end()
  } else if (address === fixture.redirectUrl) {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': contents.length })
    response.end(contents)
  } else {
    response.writeHead(404).end()
  }
})

const proxy = createHttpServer((_request, response) => response.writeHead(403).end())
const proxySockets = new Set()
proxy.on('connection', socket => {
  proxySockets.add(socket)
  socket.once('close', () => proxySockets.delete(socket))
})
proxy.on('connect', (request, client, head) => {
  const authority = request.url
  if (!allowedHosts.has(authority.slice(0, -4)) || !authority.endsWith(':443')) {
    client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    return
  }
  tunnels.push(authority)
  const backend = createConnection(origin.address().port, '127.0.0.1', () => {
    client.write('HTTP/1.1 200 Connection established\r\n\r\n')
    if (head.length) backend.write(head)
    backend.pipe(client).pipe(backend)
  })
  client.once('error', () => backend.destroy())
  client.once('close', () => backend.destroy())
  backend.once('error', () => client.destroy())
})

let app
let page
try {
  origin.listen(0, '127.0.0.1')
  await once(origin, 'listening')
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  const proxyAddress = `127.0.0.1:${proxy.address().port}`
  app = await _electron.launch({ args: ['--user-data-dir=' + profile, project] })
  const runtime = await app.evaluate(({ app: native }) => ({
    platform: process.platform, arch: native.runningUnderARM64Translation ? 'arm64' : process.arch,
  }))
  const suffixes = {
    'win32:x64': 'win-x64.exe', 'win32:arm64': 'win-arm64.exe',
    'darwin:x64': 'mac-x64.dmg', 'darwin:arm64': 'mac-arm64.dmg',
    'linux:x64': 'linux-x86_64.AppImage', 'linux:arm64': 'linux-arm64.AppImage',
  }
  const suffix = suffixes[runtime.platform + ':' + runtime.arch]
  assert.ok(suffix)
  const name = `Sujian-${newer}-${suffix}`
  const assetUrl = `${homepage}/releases/download/v${newer}/${name}`
  const redirectUrl = `https://${assetHost}/fixture/${name}`
  fixture = {
    assetUrl, redirectUrl,
    info: {
      tag_name: 'v' + newer, draft: false, prerelease: false, body: 'Chromium CONNECT proxy test.',
      assets: [{ name, browser_download_url: assetUrl, state: 'uploaded', size: contents.length, digest: 'sha256:' + checksum }],
    },
  }
  const effectiveProxy = await app.evaluate(async ({ app: native, session }, config) => {
    const { X509Certificate } = process.getBuiltinModule('node:crypto')
    native.setPath('downloads', config.downloads)
    await session.defaultSession.setProxy({ mode: 'fixed_servers', proxyRules: config.proxyAddress })
    await session.defaultSession.closeAllConnections()
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
      if (config.hosts.includes(request.hostname) &&
          new X509Certificate(request.certificate.data).fingerprint256 === config.fingerprint) callback(0)
      else callback(-3)
    })
    return session.defaultSession.resolveProxy(config.latestUrl)
  }, { downloads, proxyAddress, fingerprint, hosts: [...allowedHosts], latestUrl: latestUrl.href })
  assert.equal(effectiveProxy, 'PROXY ' + proxyAddress)

  page = await app.firstWindow()
  page.setDefaultTimeout(12000)
  await page.waitForSelector('.application[data-ready="true"]')
  await page.getByRole('button', { name: `关于素笺，当前版本 v${version}`, exact: true }).click()
  const about = page.getByRole('dialog', { name: '关于素笺', exact: true })
  await about.getByRole('button', { name: '检查更新', exact: true }).click()
  await about.getByText(`发现新版 v${newer}`, { exact: true }).waitFor()
  await about.getByRole('button', { name: runtime.platform === 'linux' ? '下载 AppImage' : '下载安装包', exact: true }).click()
  await about.getByText('已下载并通过校验', { exact: true }).waitFor()
  assert.deepEqual(await readdir(downloads), [name])
  assert.deepEqual(await readFile(path.join(downloads, name)), contents)
  assert.deepEqual(requestPaths, [latestUrl.href, assetUrl, redirectUrl])
  assert.deepEqual(new Set(tunnels), new Set([...allowedHosts].map(host => host + ':443')))
  console.log(`Chromium CONNECT verified for ${tunnels.join(', ')}. Metadata, HTTP 302, and SHA-256-verified download traversed the configured proxy.`)
} catch (error) {
  const alerts = await page?.getByRole('alert').allTextContents().catch(() => [])
  console.error({ tunnels, requestPaths, alerts })
  throw error
} finally {
  try {
    await app?.close()
  } finally {
    for (const socket of proxySockets) socket.destroy()
    await Promise.all([
      new Promise(resolve => proxy.close(resolve)),
      new Promise(resolve => origin.close(resolve)),
    ])
  }
}

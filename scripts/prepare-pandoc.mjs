import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const version = '3.13'
const releaseUrl = `https://github.com/jgm/pandoc/releases/tag/${version}`
const sourceUrl = `https://codeload.github.com/jgm/pandoc/tar.gz/refs/tags/${version}`
const sourceDigest = 'fbf6044766b0c9be5ccbf18ffe657124449e8563a177d85662ecb6f031f9c308'
const windowsAsset = {
  suffix: 'windows-x86_64.zip',
  digest: '23e1f2e978a3df80db8bf65c9c59534f41a23140480cfb4f783a882ab7dc6a4e',
  member: `pandoc-${version}/pandoc.exe`,
}
const assets = {
  'win32-x64': windowsAsset,
  'win32-arm64': windowsAsset,
  'darwin-x64': {
    suffix: 'x86_64-macOS.zip',
    digest: '1823278715aa405aaf21b59cde5dc789346aa8d4fc307467f9a9ee84162bedc5',
    member: `pandoc-${version}-x86_64/bin/pandoc`,
  },
  'darwin-arm64': {
    suffix: 'arm64-macOS.zip',
    digest: 'f436d18bebbfb3ddd326597686dacab9fac5dc23bd060495020f35a28a43a7c3',
    member: `pandoc-${version}-arm64/bin/pandoc`,
  },
  'linux-x64': {
    suffix: 'linux-amd64.tar.gz',
    digest: '38aa33b325a2bc96a4c39409631212db55702f564250bcdbead180b3bf646389',
    member: `pandoc-${version}/bin/pandoc`,
  },
  'linux-arm64': {
    suffix: 'linux-arm64.tar.gz',
    digest: '21e1d4ba09bd0b334590d204580fd4f6629b21be4ab6a32b26cc98982e9e0c68',
    member: `pandoc-${version}/bin/pandoc`,
  },
}

const run = promisify(execFile)

async function sha256(file) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}

async function download(url, destination, digest) {
  await run(process.platform === 'win32' ? 'curl.exe' : 'curl', [
    '--fail', '--silent', '--show-error', '--location', '--retry', '3', '--retry-all-errors',
    '--connect-timeout', '20', '--max-time', '300', '--output', destination, url,
  ])
  if (await sha256(destination) !== digest) throw new Error(`SHA-256 mismatch for ${url}.`)
}

const extract = (archive, destination, members) => run('tar', ['-xf', archive, '-C', destination, ...members])

async function prepareSource(directory) {
  await mkdir(directory, { recursive: true })
  const destination = path.resolve(directory, `pandoc-${version}-source.tar.gz`)
  const workspace = await mkdtemp(path.join(path.dirname(destination), '.pandoc-source-'))
  try {
    const temporary = path.join(workspace, 'source.tar.gz')
    await download(sourceUrl, temporary, sourceDigest)
    await rename(temporary, destination)
    console.log(`Pandoc source: ${destination}`)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

async function installed(directory, filename, digest) {
  try {
    const [marker, copyright, license] = await Promise.all([
      readFile(path.join(directory, 'SOURCE.txt'), 'utf8'),
      stat(path.join(directory, 'COPYRIGHT')),
      stat(path.join(directory, 'COPYING.md')),
    ])
    const expected = marker.match(/^Upstream executable SHA-256: ([0-9a-f]{64})$/m)?.[1]
    return copyright.size > 0 && license.size > 0 && marker.includes(`Archive SHA-256: ${digest}\n`)
      && expected === await sha256(path.join(directory, filename))
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function prepareBinary(platform, arch) {
  const key = `${platform}-${arch}`
  const asset = assets[key]
  if (!asset) throw new Error(`Unsupported Pandoc platform: ${key}.`)
  const filename = path.basename(asset.member)
  const directory = path.resolve('build', 'pandoc', key)
  if (await installed(directory, filename, asset.digest)) {
    console.log(`Pandoc ${version} already verified for ${key}.`)
    return
  }

  const archiveName = `pandoc-${version}-${asset.suffix}`
  const workspace = await mkdtemp(path.join(tmpdir(), 'sujian-pandoc-'))
  try {
    const archive = path.join(workspace, archiveName)
    const source = path.join(workspace, 'source.tar.gz')
    await download(`https://github.com/jgm/pandoc/releases/download/${version}/${archiveName}`, archive, asset.digest)
    await download(sourceUrl, source, sourceDigest)
    await extract(archive, workspace, [asset.member])
    await extract(source, workspace, [`pandoc-${version}/COPYRIGHT`, `pandoc-${version}/COPYING.md`])

    await mkdir(directory, { recursive: true })
    const executable = path.join(directory, filename)
    await copyFile(path.join(workspace, asset.member), executable)
    await chmod(executable, 0o755)
    for (const notice of ['COPYRIGHT', 'COPYING.md']) {
      await copyFile(path.join(workspace, `pandoc-${version}`, notice), path.join(directory, notice))
    }
    await writeFile(path.join(directory, 'SOURCE.txt'), [
      `Pandoc ${version} is bundled as a separate command-line program from the upstream release.`,
      'License: GNU GPL version 2 or later. See COPYING.md and COPYRIGHT.',
      `Upstream release: ${releaseUrl}`,
      `Corresponding source: ${sourceUrl}`,
      `Corresponding source SHA-256: ${sourceDigest}`,
      `Archive: ${archiveName}`,
      `Archive SHA-256: ${asset.digest}`,
      `Upstream executable SHA-256: ${await sha256(executable)}`,
      '',
    ].join('\n'))
    console.log(`Prepared and verified Pandoc ${version} for ${key}.`)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

const [platform = process.platform, arch = process.arch] = process.argv.slice(2)
if (platform === '--source') await prepareSource(process.argv[3] ?? 'release')
else await prepareBinary(platform, arch)

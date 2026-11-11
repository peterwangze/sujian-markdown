import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const platformFlags = { win32: '--win', darwin: '--mac', linux: '--linux' }
const [platform = process.platform, arch = process.arch, ...options] = process.argv.slice(2)
if (!Object.hasOwn(platformFlags, platform) || !['x64', 'arm64'].includes(arch)) {
  throw new Error('Use node scripts/release-package.mjs [win32|darwin|linux] [x64|arm64] [--dir].')
}
if (options.some(option => option !== '--dir')) throw new Error('Unknown packaging option.')

function runNode(entry, args) {
  const result = spawnSync(process.execPath, [entry, ...args], { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${entry} failed (${result.status ?? result.signal}).`)
}

async function runPackageBinary(packageName, command, args) {
  const manifestPath = require.resolve(`${packageName}/package.json`)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[command]
  runNode(path.resolve(path.dirname(manifestPath), entry), args)
}

await access(path.join(root, 'dist', 'index.html'))
runNode(path.join(root, 'scripts', 'prepare-pandoc.mjs'), [platform, arch])
await runPackageBinary('electron-builder', 'electron-builder', [
  platformFlags[platform], `--${arch}`, '--publish', 'never', ...options,
])

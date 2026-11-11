import electron from 'electron'
import { access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../', import.meta.url))
try {
  await access(new URL('../dist/index.html', import.meta.url))
} catch {
  console.error('Run npm run build before the desktop smoke test.')
  process.exit(1)
}

const args = [project, '--smoke-test']
if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox')

const child = spawn(electron, args, { cwd: project, stdio: 'inherit', windowsHide: true })
const timeout = setTimeout(() => child.kill(), 30000)
const code = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', (exitCode) => resolve(exitCode ?? 1))
}).finally(() => clearTimeout(timeout))

process.exitCode = code

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const suites = [
  'check-heading-shortcuts-desktop',
  'check-editing-shortcuts-desktop',
  'check-editor-pointer-desktop',
  'check-live-inline-desktop',
  'check-source-formatting-desktop',
  'check-shift-tab-desktop',
  'check-typed-lists-desktop',
  'check-file-creation-desktop',
  'check-workspace-interactions-desktop',
  'check-window-interactions-desktop',
  'check-settings-desktop',
  'check-review-workflows-desktop',
  'check-delivery-desktop',
  'check-table-layout-desktop',
  'check-content-width-desktop',
  'check-image-context-desktop',
  'check-media-export-desktop',
  'check-html-desktop',
  'check-markdown-desktop',
  'check-spellcheck-desktop',
]

for (const suite of suites) {
  const script = fileURLToPath(new URL(suite + '.mjs', import.meta.url))
  console.log('\n' + suite)
  const { status, error } = spawnSync(process.execPath, [script], { stdio: 'inherit' })
  if (error) throw error
  if (status !== 0) process.exit(status ?? 1)
}

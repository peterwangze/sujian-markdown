import assert from 'node:assert/strict'
import test from 'node:test'
import { BUILT_IN_THEMES, resolveTheme } from './themes.js'

function luminance(color) {
  const [red, green, blue] = color.slice(1).match(/../g).map(hex => {
    const channel = Number.parseInt(hex, 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(first, second) {
  const a = luminance(first)
  const b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

test('saved theme IDs still resolve, and system mode tracks the OS appearance', () => {
  for (const id of ['paper', 'light', 'dark']) assert.equal(resolveTheme(id).id, id)
  assert.equal(resolveTheme('system', false).id, 'paper')
  assert.equal(resolveTheme('system', true).id, 'dark')
  assert.equal(resolveTheme('unknown', true).id, 'paper')
  assert.equal(resolveTheme('forest').scheme, 'dark')
  assert.equal(resolveTheme('contrast').highContrast, true)
})

test('source text and Markdown syntax keep 4.5:1 contrast on canvas and selection', () => {
  const foregrounds = ['ink', 'muted', 'accent-ink', 'syntax-link', 'syntax-code', 'syntax-quote']
  for (const { id, colors } of BUILT_IN_THEMES) {
    for (const foreground of foregrounds) {
      for (const background of ['canvas', 'selection']) {
        assert.ok(contrast(colors[foreground], colors[background]) >= 4.5, `${id} ${foreground} on ${background}`)
      }
    }
  }
})

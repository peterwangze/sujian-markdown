import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeInlineStyle } from './safe-inline-css.js';

function documentWithDeclarations(declarations) {
  return {
    createElement() {
      return { style: { getPropertyValue: (property) => declarations[property] ?? '' } };
    },
  };
}

test('retains static text formatting and color functions from parsed inline CSS', () => {
  const document = documentWithDeclarations({
    'font-family': '"Noto Sans SC", sans-serif', 'font-size': '2rem', 'text-align': 'center',
    color: 'rgb(255, 0, 0)', 'background-color': 'light-dark(yellow, hsl(60, 70%, 50%))',
  });
  assert.equal(safeInlineStyle('style', document),
    'font-family: "Noto Sans SC", sans-serif; font-size: 2rem; text-align: center; color: rgb(255, 0, 0); background-color: light-dark(yellow, hsl(60, 70%, 50%));');
});

test('keeps only allowed properties and removes indirect or potentially resource-loading values', () => {
  const document = documentWithDeclarations({
    position: 'fixed', 'z-index': '999', display: 'none', 'background-image': 'url(https://example.invalid/remote.png)',
    color: 'color-mix(in srgb, red, var(--other-color))', 'background-color': 'yellow',
    'font-family': '\\url(test)', 'text-decoration-color': 'url(https://example.invalid/remote.png)',
    'font-size': 'attr(data-size px)', 'line-height': '1.5',
  });
  assert.equal(safeInlineStyle('style', document), 'line-height: 1.5; background-color: yellow;');
});

test('returns an empty value when there are no safe declarations', () => {
  assert.equal(safeInlineStyle('', null), '');
  assert.equal(safeInlineStyle('style', documentWithDeclarations({ opacity: '0', '--color': 'red' })), '');
});

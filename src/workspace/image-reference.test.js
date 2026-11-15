import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findImageReference, imageReferenceReplacement, listImageReferences, replaceImageReferences } from './image-reference.js'

test('collects images in source order and updates only image references in mixed Markdown', () => {
  const source = [
    '---',
    'example: "![metadata](not-an-image.png)"',
    '---',
    '',
    '> - [![Inline](<old space.png> "its title")](https://example.invalid/page)',
    '> - ![Linked alternative][shared] ![Shared][] ![Shared]',
    '',
    '[Ordinary link][shared]',
    '',
    '| Heading |',
    '| --- |',
    '| ![Table](old%20space.png) |',
    '',
    '<div data-source=\'<img src="fake.png">\'>',
    '  <img alt="HTML" src="folder/a&amp;b&#x2e;png" srcset="double.png 2x">',
    '  <!-- <img src="comment.png"> -->',
    '</div>',
    '',
    '`![code](sample.png)`',
    '',
    '```md',
    '![code](fenced.png)',
    '<img src="also-fenced.png">',
    '```',
    '',
    '[shared]: old%20space.png "shared title"',
    '',
  ].join('\r\n')
  const references = listImageReferences(source)
  assert.deepEqual(references.map(({ address }) => address), [
    'old space.png', 'old%20space.png', 'old%20space.png', 'old%20space.png', 'old%20space.png', 'folder/a&b.png',
  ])
  assert.deepEqual(references.map(({ from, to }) => source.slice(from, to)), [
    'old space.png', '[shared]', '[]', '', 'old%20space.png', 'folder/a&amp;b&#x2e;png',
  ])

  const updated = replaceImageReferences(source, references, new Map([
    ['old space.png', 'notes.assets/copy.png'],
    ['old%20space.png', 'notes.assets/copy.png'],
    ['folder/a&b.png', 'notes.assets/html.png'],
  ]))
  assert.equal(updated, source
    .replace('<old space.png>', '<notes.assets/copy.png>')
    .replace('![Linked alternative][shared] ![Shared][] ![Shared]',
      '![Linked alternative](notes.assets/copy.png "shared title") ![Shared](notes.assets/copy.png "shared title") ![Shared](notes.assets/copy.png "shared title")')
    .replace('![Table](old%20space.png)', '![Table](notes.assets/copy.png)')
    .replace('folder/a&amp;b&#x2e;png', 'notes.assets/html.png'))
  assert.equal(findImageReference(source, 'old space.png', 4, 5).address, 'old%20space.png')
  assert.equal(findImageReference(source, 'old space.png', 0, 1), undefined)
})

test('reports unresolved references and preserves original syntax when no source is available', () => {
  const source = [
    '![Missing][absent] ![No shortcut] ![Empty]() ![Empty bracket](<>)',
    '',
    '![File removed](missing.png)',
    '',
    '<img src="" alt="Empty HTML">',
    '',
    'Sentence <textarea>![ignored](inert.png)<img src="inert.png"></textarea> ![Remote](https://example.invalid/a.png?a=1&not=2)',
  ].join('\n')
  const references = listImageReferences(source)
  assert.deepEqual(references.filter(reference => reference.unresolved).map(reference => reference.address), [
    '![Missing][absent]', '![No shortcut]', '![Empty]()', '![Empty bracket](<>)', '<img src="" alt="Empty HTML">',
  ])
  assert.deepEqual(references.filter(reference => !reference.unresolved).map(reference => reference.address), [
    'missing.png', 'https://example.invalid/a.png?a=1&not=2',
  ])
  assert.equal(replaceImageReferences(source, references, new Map([
    ['![Missing][absent]', 'not-a-real-result.png'],
  ])), source)
})

test('retains line endings in a reference definition title reproduced at the image', () => {
  const source = '![Title][ref]\r\n\r\n[ref]: x.png "first\r\nsecond"\r\n'
  const [reference] = listImageReferences(source)
  assert.equal(source.slice(reference.from, reference.to), '[ref]')
  assert.equal(imageReferenceReplacement(reference, 'new/x.png'), '(new/x.png "first\r\nsecond")')
})

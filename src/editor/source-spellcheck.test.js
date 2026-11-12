import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { sourceSpellcheckExcluded } from './source-spellcheck.js'

function checkSource(source) {
  const state = EditorState.create({ doc: source, extensions: [markdown({ addKeymap: false })] })
  return word => {
    const from = source.indexOf(word)
    assert.notEqual(from, -1, word)
    return sourceSpellcheckExcluded(state, from, from + word.length)
  }
}

test('source spelling skips Markdown code and destinations while checking prose and link text', () => {
  const excluded = checkSource([
    'A wurd, `sommething`, [captian](https://url.example/iddress), and [frase][rrref].',
    '',
    '> ```langguage',
    '> fencederr',
    '> ```',
    '',
    '    indenterr',
    '',
    '[rrref]: /sommpath',
  ].join('\n'))

  for (const word of ['sommething', 'iddress', 'rrref', 'langguage', 'fencederr', 'indenterr', 'sommpath']) {
    assert.equal(excluded(word), true, word)
  }
  for (const word of ['wurd', 'captian', 'frase']) assert.equal(excluded(word), false, word)
})

test('source spelling skips HTML syntax and balanced inline HTML code while retaining styled prose', () => {
  const excluded = checkSource([
    'Prose <strong class="fmtname">vissible</strong> <kbd><code>termname</code></kbd> and <code>unfinished.',
    '',
    '<div>',
    'rawblocktext',
    '</div>',
    '',
    '<!-- commentname -->',
  ].join('\n'))

  for (const word of ['fmtname', 'termname', 'rawblocktext', 'commentname']) assert.equal(excluded(word), true, word)
  for (const word of ['vissible', 'unfinished']) assert.equal(excluded(word), false, word)
})

test('source spelling skips metadata and formulas while retaining ordinary dollar amounts and text', () => {
  const excluded = checkSource([
    '---',
    'configration: metadataa',
    '---',
    '',
    'Math $\\mathcal{calclation}$ and price $19 for a tickett, or $20 later.',
    '',
    '$$',
    '\\frac{denominatr}{numeratr}',
    '$$',
    '',
    'Call fetchUser in TypeScript or visit https://example.test/nakeed.',
  ].join('\n'))

  for (const word of ['configration', 'metadataa', 'calclation', 'denominatr', 'numeratr', 'fetchUser', 'TypeScript', 'nakeed']) {
    assert.equal(excluded(word), true, word)
  }
  for (const word of ['tickett', 'later']) assert.equal(excluded(word), false, word)
})

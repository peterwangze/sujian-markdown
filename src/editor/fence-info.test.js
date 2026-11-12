import test from 'node:test';
import assert from 'node:assert/strict';
import { fenceInfo, normalizeFenceLanguagesForPreview, replaceFenceLanguage } from './fence-info.js';

test('preserves code fence identifiers, classes and quoted attributes', () => {
  const info = '{#stable .python .numberLines filename="run .now.py" startFrom="4"}';
  assert.equal(fenceInfo(info).language, 'python');
  assert.equal(replaceFenceLanguage(info, 'python'), info);
  assert.equal(replaceFenceLanguage(info, 'ruby'), info.replace('.python', '.ruby'));
  assert.equal(replaceFenceLanguage(info, ''), info.replace('.python ', ''));
  assert.equal(replaceFenceLanguage('{#stable .numberLines}', 'python'), '{.python #stable .numberLines}');
});

test('keeps shortcut fence attributes when replacing or clearing a language', () => {
  const info = 'python {.numberLines filename="run.py"}';
  assert.equal(replaceFenceLanguage(info, 'ruby'), 'ruby {.numberLines filename="run.py"}');
  assert.equal(replaceFenceLanguage(info, ''), '{.numberLines filename="run.py"}');
  assert.equal(replaceFenceLanguage('python', ''), '');
});

test('changes Quarto cell languages without changing braces or options', () => {
  const cell = '{python setup, echo=FALSE}';
  assert.equal(fenceInfo(cell).kind, 'cell');
  assert.equal(replaceFenceLanguage(cell, 'python'), cell);
  assert.equal(replaceFenceLanguage(cell, 'r'), '{r setup, echo=FALSE}');
  assert.equal(replaceFenceLanguage(cell, ''), null);
  assert.equal(replaceFenceLanguage('{{python}}', 'r'), '{{r}}');
  assert.equal(replaceFenceLanguage('{=html}', 'javascript'), null);
  assert.equal(replaceFenceLanguage('{.python #incomplete', 'ruby'), null);
});

test('normalizes only actual structured code fence headers for preview', () => {
  const source = [
    '# Example {#id}', '', '```{#stable .python .numberLines}', 'print(1)', '```', '',
    '~~~~{python}', '#| echo: false', 'print(2)', '~~~~', '',
    '```{=html}', '<div>Literal raw block</div>', '```', '',
    '````text', '```{.ruby}', 'This is documentation.', '```', '````', '',
  ].join('\n');
  const expected = source.replace('```{#stable .python .numberLines}', '```python').replace('~~~~{python}', '~~~~python');
  assert.equal(normalizeFenceLanguagesForPreview(source), expected);
});

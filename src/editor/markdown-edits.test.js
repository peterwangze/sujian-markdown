import test from 'node:test';
import assert from 'node:assert/strict';
import { diffChars } from 'diff';
import { diffParts, projectMarkdownEdit, spliceChanges } from './markdown-edits.js';

test('keeps formatting and CRLF when applying a visual edit', () => {
  const source = '# Heading   \r\n\r\nA _word_\r\n\r\n<!-- comment -->\r\n';
  const serialized = '# Heading\n\nA _word_\n\n<!-- comment -->\n';
  assert.equal(projectMarkdownEdit(source, serialized, serialized), source);
  assert.equal(
    projectMarkdownEdit(source, serialized, serialized.replace('word', '**word**')),
    source.replace('word', '**word**'),
  );
});

test('preserves line endings when editing on a line boundary', () => {
  assert.equal(projectMarkdownEdit('A\r\nB', 'A\nB', 'Ax\nB'), 'Ax\r\nB');
  assert.equal(projectMarkdownEdit('A\r\nB', 'A\nB', 'AB'), 'AB');
  assert.equal(projectMarkdownEdit('A', 'A\n', 'A\nB\n'), 'A\nB\n');
});

test('projects loose-list indentation after the preserved blank line', () => {
  const raw = '# Heading  \n\n- parent\n\n- child word\n\n  second paragraph\n\nUnchanged *content*\n';
  const before = raw.replace('Heading  ', 'Heading').replace('parent\n\n', 'parent\n');
  const after = before.replace('parent\n- child', 'parent\n\n  - child').replace('  second', '    second');
  const expected = raw.replace('- child', '  - child').replace('  second', '    second');
  assert.equal(projectMarkdownEdit(raw, before, after), expected);
  assert.equal(projectMarkdownEdit(raw.replaceAll('\n', '\r\n'), before, after), expected.replaceAll('\n', '\r\n'));
});

test('long texts are aligned by line and compared in detail where lines changed', () => {
  const lines = Array.from({ length: 5000 }, (_, index) => `第 ${index} 行 line ${index} 文本`);
  const before = lines.join('\n');
  const after = before.replace('第 2500 行 line 2500 文本', '第 2500 行 line 2500 改过的文本').replace('第 10 行 line 10 文本\n', '');
  const parts = diffParts(before, after);
  const applied = (text, part) => part.added ? text + part.value : part.removed ? text : text + part.value;
  assert.equal(parts.reduce(applied, ''), after);
  // Only the changed words are reported, not the lines around them.
  assert.ok(parts.filter((part) => part.added || part.removed).length <= 4);
  assert.deepEqual(parts.find((part) => part.added).value, '改过的');
  assert.deepEqual(diffParts('kitten', 'sitting'), diffChars('kitten', 'sitting'));
});

test('a long text that differs in every line is compared in time', () => {
  const before = Array.from({ length: 4000 }, (_, index) => `line ${index} x`).join('\n');
  const after = Array.from({ length: 4000 }, (_, index) => `LINE ${index} y`).join('\n');
  const begun = performance.now();
  const parts = diffParts(before, after);
  const applied = (text, part) => part.added ? text + part.value : part.removed ? text : text + part.value;
  assert.equal(parts.reduce(applied, ''), after);
  assert.ok(performance.now() - begun < 1000);
});

test('changes far apart in a long text without line breaks are found on their own', () => {
  const pieces = Array.from({ length: 2000 }, (_, index) => `第${index}段 ${'文字'.repeat(index % 17)}，`);
  const before = pieces.join('');
  const after = before.slice(0, 30_000) + 'X' + before.slice(30_000, 90_000) + 'Y' + before.slice(90_000);
  const begun = performance.now();
  const parts = diffParts(before, after);
  assert.deepEqual(parts.filter((part) => part.added || part.removed).map((part) => [part.added, part.value]), [[true, 'X'], [true, 'Y']]);
  assert.equal(parts.filter((part) => !part.added).map((part) => part.value).join(''), before);
  assert.equal(parts.filter((part) => !part.removed).map((part) => part.value).join(''), after);
  assert.ok(performance.now() - begun < 1000);
});

test('a long text whose halves were swapped is still reported in time', () => {
  const pieces = Array.from({ length: 1000 }, (_, index) => `第${index}段 ${'文字'.repeat(index % 17)}，`);
  const before = pieces.join('');
  const after = before.slice(before.length / 2) + before.slice(0, before.length / 2);
  const begun = performance.now();
  const parts = diffParts(before, after);
  assert.equal(parts.filter((part) => !part.added).map((part) => part.value).join(''), before);
  assert.equal(parts.filter((part) => !part.removed).map((part) => part.value).join(''), after);
  assert.ok(performance.now() - begun < 2000);
});

test('editor changes are spliced into a document that equals the editor text', () => {
  const changes = { iterChanges: (visit) => {
    visit(1, 3, 1, 3, { toString: () => 'XY' });
    visit(5, 5, 4, 5, { toString: () => '!' });
  } };
  assert.equal(spliceChanges('abcdef', changes), 'aXYde!f');
});

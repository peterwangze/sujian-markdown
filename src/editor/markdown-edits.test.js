import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMarkdownEdit } from './markdown-edits.js';

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

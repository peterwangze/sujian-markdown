import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { formatMarkdown } from './format.js';
import { formatSourceInlineSelection, removeSourceInlineFormat, setSourceHeading } from './source-format.js';

function editor(doc, anchor, head = anchor) {
  return {
    state: EditorState.create({ doc, selection: { anchor, head }, extensions: markdown() }),
    dispatch(update) { this.state = this.state.update(update).state; },
  };
}

test('changes heading levels in source while retaining quote markers and code content', () => {
  const quoted = editor('> ## 标题 ##', 6);
  assert.equal(setSourceHeading(quoted, 4), true);
  assert.equal(quoted.state.doc.toString(), '> #### 标题 ##');
  assert.equal(setSourceHeading(quoted, 0), true);
  assert.equal(quoted.state.doc.toString(), '> 标题');

  const setext = editor('标题\n===\n\n正文', 1);
  assert.equal(setSourceHeading(setext, 0), true);
  assert.equal(setext.state.doc.toString(), '标题\n\n正文');

  const fence = editor('```\n# 字面文本\n```', 8);
  assert.equal(setSourceHeading(fence, 2), false);
});

test('toggles source markers without removing surrounding list spacing or other occurrences', () => {
  const strike = formatMarkdown('strike', undefined, '  删除此处 ');
  assert.deepEqual(strike, { text: '  ~~删除此处~~ ', offset: 4, length: 4 });
  const selected = editor('- ~~文本~~ 与 ~~文本~~', 13, 15);
  assert.equal(removeSourceInlineFormat(selected, 'strike'), true);
  assert.equal(selected.state.doc.toString(), '- ~~文本~~ 与 文本');

  const emphasized = editor('**选择此处**', 2, 6);
  assert.equal(removeSourceInlineFormat(emphasized, 'bold'), true);
  assert.equal(emphasized.state.doc.toString(), '选择此处');
  assert.equal(emphasized.state.sliceDoc(emphasized.state.selection.main.from, emphasized.state.selection.main.to), '选择此处');

  const partlySelected = editor('**first center last**', 14, 8);
  assert.equal(removeSourceInlineFormat(partlySelected, 'bold'), true);
  assert.equal(partlySelected.state.doc.toString(), '**first** center **last**');
  assert.ok(partlySelected.state.selection.main.anchor > partlySelected.state.selection.main.head);
});

test('formats source selections across blocks without wrapping Markdown markers or code', () => {
  const input = [
    'Prose', '', '## Heading ##', '', '> Quote', '> continued', '',
    '- [x] Task', '', '| Left | Right |', '| --- | --- |', '| One | Two |', '', '~~~', 'Code', '~~~',
  ].join('\n');
  const expected = [
    '**Prose**', '', '## **Heading** ##', '', '> **Quote**', '> **continued**', '',
    '- [x] **Task**', '', '| **Left** | **Right** |', '| --- | --- |', '| **One** | **Two** |', '', '~~~', 'Code', '~~~',
  ].join('\n');
  const selected = editor(input, input.length, 0);
  assert.equal(formatSourceInlineSelection(selected, 'bold'), true);
  assert.equal(selected.state.doc.toString(), expected);
  assert.ok(selected.state.selection.main.anchor > selected.state.selection.main.head);
  assert.equal(formatSourceInlineSelection(selected, 'bold'), true);
  assert.equal(selected.state.doc.toString(), input);
});

test('formatting marks keep edge spaces and preserve multi-word scripts', () => {
  for (const [command, marker] of [['highlight', '=='], ['superscript', '^'], ['subscript', '~']]) {
    assert.equal(formatMarkdown(command, undefined, ' two words ').text, ` ${marker}two words${marker} `);
    const doc = `Before ${marker}two words${marker} after`;
    const from = doc.indexOf('two words');
    const view = editor(doc, from, from + 'two words'.length);
    assert.equal(removeSourceInlineFormat(view, command), true);
    assert.equal(view.state.doc.toString(), 'Before two words after');
  }
});

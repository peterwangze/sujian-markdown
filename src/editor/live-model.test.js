import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveModel, serveMarkdown } from './live-model.js';

// A small stand-in for the editor DOM: what the model reads and what the tests change.
class Node {
  constructor(nodeType, tag = '', data = '') {
    this.nodeType = nodeType;
    this.tag = tag;
    this.data = data;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.connected = false;
  }

  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes.at(-1) ?? null; }
  get className() { return this.attributes.get('class') ?? ''; }
  set className(value) { this.setAttribute('class', value); }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node.connected;
  }
  get innerHTML() { return this.childNodes.map((node) => node.outerHTML).join(''); }
  get outerHTML() {
    if (this.nodeType === 3) return this.data.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const attributes = [...this.attributes].map(([name, value]) => ` ${name}="${value}"`).join('');
    return `<${this.tag}${attributes}>${this.innerHTML}</${this.tag}>`;
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  adopt(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
      node.parentNode = this;
      this.childNodes.push(node);
    }
    return this;
  }
  remove() { this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; }
  replaceWith(...nodes) {
    const parent = this.parentNode;
    const index = parent.childNodes.indexOf(this);
    this.parentNode = null;
    nodes.forEach((node, offset) => {
      if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
      node.parentNode = parent;
      parent.childNodes.splice(index + offset, 0, node);
    });
    parent.childNodes.splice(parent.childNodes.indexOf(this), 1);
  }
}

const unescape = (html) => html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const text = (value) => new Node(3, '', value);
const element = (tag, attributes, children = []) => {
  const node = new Node(1, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node.adopt(...children);
};
const paragraph = (value) => element('p', { 'data-type': 'p' }, [text(value)]);

// The Markdown of the editor as Lute writes it: blocks separated by blank
// lines, and a code block that ends the document with a single line break.
// Quirks add rules that reach past the blocks around an edit.
function lute(quirks = {}) {
  const inline = (html) => unescape(html.replace(/<[^>]+>/g, ''));
  return (html) => {
    const blocks = [];
    for (const match of html.matchAll(/<(p|h2|ul|pre)(?=[\s>])([^>]*)>([\s\S]*?)<\/\1>/g)) {
      const [, tag, attributes, inner] = match;
      if (tag === 'p') blocks.push({ kind: 'p', text: inline(inner) });
      else if (tag === 'h2') blocks.push({ kind: 'heading', text: '## ' + inline(inner) });
      else if (tag === 'pre') blocks.push({ kind: 'code', text: '```\n' + inline(inner) + '\n```' });
      else blocks.push({ kind: 'list', text: [...inner.matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/g)].map((item) => {
        const task = /\sdata-task="[^"]*"/.test(item[1]);
        return (task ? /\schecked="[^"]*"/.test(item[1]) ? '- [x] ' : '- [ ] ' : '- ') + inline(item[2]);
      }).join('\n') });
    }
    blocks.forEach((block, index) => {
      if (quirks.afterCode && block.kind === 'p' && blocks[index - 1]?.kind === 'code') block.text = quirks.afterCode + block.text;
      if (quirks.many && blocks.length >= 5 && index === blocks.length - 1) block.text += quirks.many;
      if (quirks.everywhere) block.text += ' #' + blocks.length;
    });
    return blocks.map((block, index) => {
      const separator = index === 0 ? '' : block.kind === 'code' ? '\n\n\n' : '\n\n';
      const end = index === blocks.length - 1 && block.kind === 'code' ? '\n' : '';
      return separator + block.text + end;
    }).join('');
  };
}

const editor = () => {
  const root = new Node(1, 'div');
  root.connected = true;
  return root.adopt(
    paragraph('First'),
    element('h2', { 'data-type': 'h2' }, [text('Heading')]),
    paragraph('Third _em_'),
    element('ul', { 'data-type': 'ul' }, [
      element('li', { 'data-marker': '-', 'data-task': 'todo' }, [text('a')]),
      element('li', { 'data-marker': '-', 'data-task': 'todo' }, [text('b')]),
    ]),
    element('pre', {}, [text('x = 1')]),
    paragraph('Last'),
  );
};
// The same document as it is written in the file, with other formatting.
const file = 'First\n\nHeading\n=======\n\nThird *em*\n\n* [ ] a\n* [ ] b\n\n    x = 1\n\nLast';
const markdown = 'First\n\n## Heading\n\nThird _em_\n\n- [ ] a\n- [ ] b\n\n\n```\nx = 1\n```\n\nLast';
const whole = (root) => lute()(root.innerHTML);
const edit = (model, node) => model.observe([{ type: 'characterData', target: node }]);
const list = (model, target, addedNodes = [], removedNodes = []) =>
  model.observe([{ type: 'childList', target, addedNodes, removedNodes }]);

function harness({ raw = file, quirks, root = editor() } = {}) {
  const convert = lute(quirks);
  const sizes = [];
  const waiting = new Set();
  const model = createLiveModel({
    element: root,
    convert: (html) => { sizes.push(html.length); return convert(html); },
    idle: (work) => { waiting.add(work); return work; },
    cancel: (work) => waiting.delete(work),
  });
  model.reset(raw);
  // Runs the pending background work; `time` is what the browser has to spare.
  const rest = (time = 50) => {
    for (const work of [...waiting]) {
      waiting.delete(work);
      work({ timeRemaining: () => time });
    }
  };
  // Whether the editor was converted in full since the last `rest`.
  const full = () => sizes.splice(0).some((size) => size >= root.innerHTML.length);
  return { model, root, convert, rest, sizes, full, waiting };
}

test('typing in a block keeps the formatting of the file elsewhere', () => {
  const { model, root, rest, full } = harness();
  rest();
  full();
  root.lastChild.firstChild.data = 'Last!';
  edit(model, root.lastChild.firstChild);
  assert.equal(model.flush(), file.replace('Last', 'Last!'));
  assert.equal(model.text(), markdown.replace('Last', 'Last!'));
  // Only the blocks around the edit were converted again.
  assert.equal(full(), false);
  // Nothing more changed, and the whole editor confirms the estimate.
  assert.equal(model.flush(), null);
  model.flush(undefined, true);
  assert.equal(model.text(), whole(root));
});

test('blocks rebuilt with the same Markdown are not a change', () => {
  const { model, root, rest, full } = harness();
  rest();
  full();
  root.lastChild.replaceWith(paragraph('Last'));
  list(model, root, [root.lastChild], []);
  assert.equal(model.flush(), null);
  assert.equal(full(), false);
  root.lastChild.firstChild.data = 'Last!';
  edit(model, root.lastChild.firstChild);
  assert.equal(model.flush(), file.replace('Last', 'Last!'));
});

test('rebuilt blocks with other Markdown are edits', () => {
  const { model, root, rest } = harness();
  rest();
  root.childNodes[2].replaceWith(paragraph('Third _em_ and more'));
  list(model, root);
  assert.equal(model.flush(), file.replace('Third *em*', 'Third *em* and more'));
  assert.equal(model.text(), whole(root));
});

test('an editor built again is converted only where it differs', () => {
  const { model, root, rest, sizes } = harness();
  rest();
  root.childNodes[2].replaceWith(paragraph('Third _em_ and more'));
  list(model, root);
  assert.equal(model.flush(), file.replace('Third *em*', 'Third *em* and more'));
  // Undo builds every block of the editor again; all but one are as they were.
  const before = [...root.childNodes];
  const again = editor().childNodes;
  for (const node of before) node.remove();
  root.adopt(...again);
  list(model, root, again, before);
  sizes.length = 0;
  assert.equal(model.flush(), file);
  // The blocks around the one that differs were converted again, and no other.
  assert.ok(sizes.length < 6, String(sizes.length));
  assert.equal(model.text(), markdown);
  // The blocks built again are known from then on.
  sizes.length = 0;
  assert.equal(model.flush(), null);
});

test('a new block splits the line of the file', () => {
  const { model, root, rest, full } = harness();
  rest();
  full();
  root.lastChild.replaceWith(paragraph('Las'), paragraph('t'));
  list(model, root);
  assert.equal(model.flush(), file.replace('Last', 'Las\n\nt'));
  assert.equal(model.text(), whole(root));
  assert.equal(full(), false);
  root.lastChild.firstChild.data = 't and more';
  edit(model, root.lastChild.firstChild);
  assert.equal(model.flush(), file.replace('Last', 'Las\n\nt and more'));
});

test('a removed block joins the lines of the file', () => {
  const { model, root, rest } = harness();
  rest();
  root.lastChild.replaceWith(paragraph('Las'), paragraph('t'));
  list(model, root);
  assert.equal(model.flush(), file.replace('Last', 'Las\n\nt'));
  root.lastChild.remove();
  list(model, root, [], [root.lastChild]);
  root.lastChild.firstChild.data = 'Last';
  edit(model, root.lastChild.firstChild);
  assert.equal(model.flush(), file);
  assert.equal(model.text(), whole(root));
});

test('a checkbox is an edit made only in attributes', () => {
  const { model, root, rest } = harness();
  rest();
  const item = root.childNodes[3].firstChild;
  item.setAttribute('checked', 'checked');
  model.observe([{ type: 'attributes', attributeName: 'checked', target: item }]);
  assert.equal(model.flush(), file.replace('* [ ] a', '* [x] a'));
  // Attributes Lute does not read, and the expanded state of a node, are left alone.
  item.setAttribute('data-sujian-active', '');
  model.observe([{ type: 'attributes', attributeName: 'data-sujian-active', target: item }]);
  item.className = 'vditor-ir__node vditor-ir__node--expand';
  model.observe([{ type: 'attributes', attributeName: 'class', target: item, oldValue: 'vditor-ir__node' }]);
  assert.equal(model.flush(), null);
  // A class added to an element that had none has no earlier value.
  const text = root.childNodes[0];
  text.setAttribute('class', 'vditor-ir__node vditor-ir__node--expand');
  model.observe([{ type: 'attributes', attributeName: 'class', target: text, oldValue: null }]);
  assert.equal(model.flush(), null);
  // The classes of an SVG element are not a string.
  Object.defineProperty(text, 'className', { value: { baseVal: 'vditor-ir__node vditor-ir__node--expand' } });
  text.setAttribute('class', 'vditor-ir__node vditor-ir__node--expand vditor-ir__node--other');
  model.observe([{ type: 'attributes', attributeName: 'class', target: text, oldValue: 'vditor-ir__node vditor-ir__node--expand' }]);
  assert.equal(model.flush(), null);
  assert.equal(model.text(), whole(root));
});

test('the caret marker of an undo snapshot is not an edit', () => {
  const { model, root, rest } = harness();
  rest();
  const last = root.lastChild;
  last.firstChild.data = 'Las';
  edit(model, last.firstChild);
  const marker = element('span', { class: 'vditor-wbr' });
  last.adopt(marker);
  list(model, last, [marker]);
  marker.remove();
  list(model, last, [], [marker]);
  assert.equal(model.flush(), file.replace('Last', 'Las'));
});

test('edits made before anything asked for the Markdown are kept', () => {
  const { model, root, full } = harness();
  // A block Vditor rebuilds, one it leaves alone, and blocks it adds and removes.
  root.childNodes[5].replaceWith(paragraph('Las'), paragraph(''));
  list(model, root);
  root.childNodes[0].firstChild.data = 'First!';
  edit(model, root.childNodes[0].firstChild);
  root.childNodes[3].replaceWith(element('ul', { 'data-type': 'ul' }, [
    element('li', { 'data-marker': '-', 'data-task': 'todo', checked: 'checked' }, [text('a')]),
    element('li', { 'data-marker': '-', 'data-task': 'todo' }, [text('b')]),
  ]));
  list(model, root);
  assert.equal(model.flush(), file.replace('First', 'First!').replace('* [ ] a', '* [x] a').replace('Last', 'Las\n\n'));
  assert.equal(model.text(), whole(root));
  assert.equal(full(), true);
  // A paragraph removed before the editor was converted in full.
  const second = harness({ raw: markdown });
  second.root.childNodes[2].remove();
  list(second.model, second.root, [], []);
  assert.equal(second.model.flush(), markdown.replace('Third _em_\n\n', ''));
  assert.equal(second.model.text(), whole(second.root));
});

test('an edit before the index reached the block is still right', () => {
  const root = new Node(1, 'div');
  root.connected = true;
  const blocks = [];
  for (let index = 0; index < 420; index += 1) blocks.push(paragraph(`第 ${index} 段`));
  root.adopt(...blocks);
  const raw = blocks.map((block) => block.firstChild.data).join('\n\n');
  const expected = raw.replace('第 200 段', '第 200 段（改）').replace('第 300 段', '第 300 段（改）');
  const { model, rest, full } = harness({ root, raw });
  rest();
  // The browser had no time to spare: the first blocks are located, the rest are not.
  rest(0);
  const rebuilt = paragraph('第 200 段（改）');
  blocks[200].replaceWith(rebuilt);
  list(model, root);
  blocks[300].firstChild.data = '第 300 段（改）';
  edit(model, blocks[300].firstChild);
  full();
  assert.equal(model.flush(), expected);
  assert.equal(model.text(), whole(root));
  assert.equal(full(), false);
  // The index is complete, so later edits stay small.
  rest();
  blocks[410].firstChild.data = '第 410 段（改）';
  edit(model, blocks[410].firstChild);
  full();
  assert.equal(model.flush(), expected.replace('第 410 段', '第 410 段（改）'));
  assert.equal(full(), false);
});

test('a block that cannot be located does not keep the document from the index', () => {
  // In the whole editor the last paragraph starts with a note that it lacks on its own.
  const { model, root, rest, full, convert } = harness({ quirks: { afterCode: '注意：'.repeat(4) } });
  rest();
  root.childNodes[0].firstChild.data = 'First!';
  edit(model, root.childNodes[0].firstChild);
  full();
  assert.equal(model.flush(), file.replace('First', 'First!'));
  assert.equal(full(), false);
  // An edit there falls back to the whole editor and is still placed.
  root.lastChild.firstChild.data = 'Last!';
  edit(model, root.lastChild.firstChild);
  full();
  assert.equal(model.flush(), file.replace('First', 'First!').replace('Last', 'Last!'));
  assert.equal(full(), true);
  assert.equal(model.text(), convert(root.innerHTML));
});

test('a rule that reaches past the blocks around an edit makes the model convert the whole editor', () => {
  const { model, root, rest, full, convert } = harness({ quirks: { everywhere: true } });
  rest();
  root.lastChild.firstChild.data = 'Last!';
  edit(model, root.lastChild.firstChild);
  full();
  assert.equal(model.flush(), file.replace('Last', 'Last!'));
  assert.equal(full(), true);
  assert.equal(model.text(), convert(root.innerHTML));
});

test('a whole-document conversion corrects an estimate that was wrong', () => {
  const raw = file.replace('Last', 'Last end.');
  const { model, root, rest, convert } = harness({ raw, quirks: { many: ' end.' } });
  rest();
  root.lastChild.firstChild.data = 'Last!';
  edit(model, root.lastChild.firstChild);
  // The three blocks of the window are too few for the rule, so the ending goes missing.
  assert.equal(model.flush(), raw.replace('Last end.', 'Last!'));
  const corrected = model.flush(undefined, true);
  assert.equal(corrected, raw.replace('Last end.', 'Last! end.'));
  assert.equal(model.text(), convert(root.innerHTML));
  // From here on the document follows whole-document conversions.
  root.lastChild.firstChild.data = 'Last!!';
  edit(model, root.lastChild.firstChild);
  assert.equal(model.flush(), raw.replace('Last end.', 'Last!! end.'));
});

test('a document with an indented code block is converted in full', () => {
  const root = new Node(1, 'div');
  root.connected = true;
  const block = new Node(1, 'div');
  block.dataset.type = 'code-block';
  block.adopt(element('pre', {}, [text('code')]));
  root.adopt(paragraph('text'), block, paragraph('after'));
  const { model, rest, full } = harness({ root, raw: 'text\n\n    code\n\nafter' });
  rest();
  root.lastChild.firstChild.data = 'after!';
  edit(model, root.lastChild.firstChild);
  full();
  assert.equal(model.flush(), 'text\n\n    code\n\nafter!');
  assert.equal(full(), true);
});

test('nothing is converted while nothing changed', () => {
  const { model, rest, sizes, full } = harness();
  assert.equal(model.flush(), null);
  assert.equal(model.flush(undefined, true), null);
  assert.equal(sizes.length, 0);
  // Asked for the text, it is converted once and the index follows in the background.
  assert.equal(model.text(), markdown);
  assert.equal(sizes.length, 1);
  full();
  rest();
  assert.equal(model.text(), markdown);
  assert.equal(model.flush(), null);
  assert.equal(full(), false);
});

test('documents with CRLF line breaks keep them', () => {
  const { model, root, rest } = harness({ raw: file.replaceAll('\n', '\r\n') });
  rest();
  root.lastChild.firstChild.data = 'Last!';
  edit(model, root.lastChild.firstChild);
  assert.equal(model.flush(), file.replaceAll('\n', '\r\n').replace('Last', 'Last!'));
});

test('Vditor is given the estimate when it asks for the Markdown of the whole editor', () => {
  const root = editor();
  const { model, rest, sizes } = harness({ root });
  rest();
  sizes.length = 0;
  let asked = 0;
  const vditor = { currentMode: 'ir', ir: { element: root }, lute: { VditorIRDOM2Md: (html) => { asked += 1; return lute()(html); } } };
  const served = serveMarkdown(vditor, () => { model.flush(); return model.text(); });
  root.lastChild.firstChild.data = 'Last!';
  edit(model, root.lastChild.firstChild);
  const text = vditor.lute.VditorIRDOM2Md(root.innerHTML);
  assert.ok(served(text));
  assert.equal(asked, 0);
  assert.ok(text.endsWith('Last!'));
  // Only the blocks around the edit were converted again.
  assert.equal(sizes.some((size) => size >= root.innerHTML.length), false);
  // Anything short of the whole editor is converted, and nothing else counts as served.
  const part = vditor.lute.VditorIRDOM2Md(root.lastChild.outerHTML);
  assert.equal(part, 'Last!');
  assert.equal(asked, 1);
  assert.equal(served(part), false);
  // A document that does not follow the model is converted as before.
  let bare = 0;
  const other = { currentMode: 'ir', ir: { element: root }, lute: { VditorIRDOM2Md: (html) => { bare += 1; return lute()(html); } } };
  const isServed = serveMarkdown(other, () => null);
  assert.equal(other.lute.VditorIRDOM2Md(root.innerHTML), whole(root));
  assert.equal(bare, 1);
  assert.equal(isServed(whole(root)), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { speedUpLiveEngine } from './live-engine.js';

// Vditor undoes with the diff-match-patch it brings along.
const DMP = createRequire(import.meta.url)('diff-match-patch');

const mark = (text) => `<span data-type="em" class="vditor-ir__marker vditor-ir__marker--bi">${text}</span>`;
const strong = (text) => `<strong data-type="strong">${mark('**')}${text}${mark('**')}</strong>`;
const em = (text) => `<em data-type="em" class="vditor-ir__node">${mark('*')}${text}${mark('*')}</em>`;
const paragraph = (text, extra = '') => `<p data-block="0" data-type="p"${extra}>${text}</p>`;

function engine() {
  const vditor = { undo: { dmp: new DMP() }, outline: {} };
  speedUpLiveEngine(vditor);
  return vditor.undo.dmp;
}

// What Vditor does with the patches: the newer text gets them, the restored
// text gets them inverted and reversed.
function roundTrip(dmp, after, before) {
  const patches = dmp.patch_make(after, before, dmp.diff_main(after, before, true));
  const [undone, undoResults] = dmp.patch_apply(patches, after);
  const redo = dmp.patch_deepCopy(patches).reverse();
  for (const patch of redo) for (const diff of patch.diffs) diff[0] = -diff[0];
  const [redone, redoResults] = dmp.patch_apply(redo, undone);
  return { patches, undone, undoResults, redone, redoResults };
}

// Patches built by the library find their place without a fuzzy search. Ours must too.
function exactOnly(dmp) {
  dmp.match_main = (text, pattern, at) => text.substr(at, pattern.length) === pattern ? at : -1;
}

function random(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

test('formatting in several places undoes and redoes exactly', () => {
  const before = paragraph('Toolbar boundary <wbr>anotherword remains.', ' class="vditor-wbr"') +
    paragraph('Mixed lead ' + strong('BoldInside') + ' and PlainInside tail.');
  const after = paragraph('Toolbar boundary anotherword remains.') +
    paragraph('Mixed lead ' + em('<wbr>' + strong('BoldInside') + ' and PlainInside') + ' tail.');
  const dmp = engine();
  exactOnly(dmp);
  const result = roundTrip(dmp, after, before);
  assert.equal(result.undone, before);
  assert.equal(result.redone, after);
  assert.equal(result.patches.length, 4);
});

test('differences reassemble both texts', () => {
  const before = paragraph('one <wbr>two') + paragraph('three');
  const after = paragraph('one two') + paragraph('three four');
  const parts = engine().diff_main(after, before, true);
  assert.deepEqual([...new Set(parts.map(([type]) => type))].sort(), [-1, 0, 1]);
  assert.equal(parts.filter(([type]) => type !== 1).map(([, value]) => value).join(''), after);
  assert.equal(parts.filter(([type]) => type !== -1).map(([, value]) => value).join(''), before);
});

test('any edit undoes and redoes exactly', () => {
  const tokens = ['<p data-block="0" data-type="p">', '</p>', '<em data-type="em">', '</em>', '**', '*', '<wbr>', 'ab', 'ab',
    'Mixed lead ', 'anotherword ', 'PlainInside', '甲', '乙乙', '\n', '  ', '<wbr>'];
  const next = random(20261126);
  const pick = (list) => list[Math.floor(next() * list.length)];
  let compared = 0;
  let beyondTheLibrary = 0;
  for (let round = 0; compared < 500; round += 1) {
    const text = () => Array.from({ length: Math.floor(next() * 160) }, () => pick(tokens)).join('');
    const before = text();
    let after = before;
    for (let edit = Math.floor(next() * 8); edit >= 0; edit -= 1) {
      const from = Math.floor(next() * (after.length + 1));
      const to = Math.min(after.length, from + Math.floor(next() * 60));
      after = after.slice(0, from) + (next() < 0.5 ? pick(tokens) : '') + after.slice(next() < 0.7 ? to : from);
    }
    if (after === before) continue;
    const dmp = engine();
    exactOnly(dmp);
    const result = roundTrip(dmp, after, before);
    const where = `round ${round}\n${before}\n${after}`;
    assert.ok(result.undoResults.every(Boolean), `undo missed a place\n${where}`);
    assert.ok(result.redoResults.every(Boolean), `redo missed a place\n${where}`);
    assert.equal(result.undone, before, `undo result\n${where}`);
    assert.equal(result.redone, after, `redo result\n${where}`);
    // The check asks more of the patches than Vditor does. The library's own must stand it too.
    const library = new DMP();
    exactOnly(library);
    const own = roundTrip(library, after, before);
    if (own.undone !== before || own.redone !== after) beyondTheLibrary += 1;
    compared += 1;
  }
  assert.equal(compared, 500);
  assert.equal(beyondTheLibrary, 0);
});

test('a redo in a document that repeats itself puts each change back in its own place', () => {
  // Around two equal changes in equal surroundings, the reading for undo seems to fit the redo as well.
  for (const [unit, places, added] of [
    ['a', [100, 200], ['x', 'x']],
    ['| a | b |\n', [33, 66], ['| a | b |\n', '| a | b |\n']],
  ]) {
    const before = unit.repeat(Math.ceil(400 / unit.length));
    let after = before;
    for (const [index, from] of [...places.entries()].sort((left, right) => right[1] - left[1])) {
      after = after.slice(0, from) + added[index] + after.slice(from);
    }
    const dmp = engine();
    exactOnly(dmp);
    const result = roundTrip(dmp, after, before);
    assert.equal(result.patches.length, 2);
    assert.ok(result.undoResults.every(Boolean) && result.redoResults.every(Boolean));
    assert.equal(result.undone, before);
    assert.equal(result.redone, after);
  }
});

test('a keystroke in a large repetitive document makes one small patch', () => {
  const before = paragraph('这是第 100 段用于性能测试的中文正文，包含 English words、数字 7919 与标点。').repeat(2400);
  const at = before.length / 2 + 30;
  const after = before.slice(0, at) + 'x' + before.slice(at);
  const dmp = engine();
  exactOnly(dmp);
  const started = performance.now();
  const result = roundTrip(dmp, after, before);
  const took = performance.now() - started;
  assert.equal(result.patches.length, 1);
  assert.ok(result.patches[0].length1 < 48);
  assert.equal(result.undone, before);
  assert.equal(result.redone, after);
  assert.ok(took < 1500, `${Math.round(took)} ms`);
});

test('a keystroke after the caret moved far away makes two small patches', () => {
  const before = paragraph('这是第 100 段用于性能测试的中文正文，包含 English words、数字 7919 与标点。').repeat(2400);
  const at = before.length / 2 + 30;
  const after = before.slice(0, 900) + '<wbr>' + before.slice(900, at) + 'x' + before.slice(at);
  const dmp = engine();
  exactOnly(dmp);
  const started = performance.now();
  const result = roundTrip(dmp, after, before);
  const took = performance.now() - started;
  assert.equal(result.patches.length, 2);
  assert.ok(result.patches.every((patch) => patch.length1 < 48), JSON.stringify(result.patches.map((patch) => patch.length1)));
  assert.equal(result.undone, before);
  assert.equal(result.redone, after);
  assert.ok(took < 1500, `${Math.round(took)} ms`);
});

// Undo brings back every change since a snapshot. Opening a document
// highlights its code blocks afterwards, so an undo can move hundreds of
// small patches through the document.
function highlighted(characters) {
  const code = (on) => `<code class="language-js${on ? ' hljs' : ''}">var value</code>`;
  let before = '';
  let after = '';
  for (let index = 0; before.length < characters; index += 1) {
    before += paragraph(`A line of the text ${strong('BoldInside')} and ${code(index % 7 === 3)} words. ${index}. `);
    after += paragraph(`A line of the text ${strong('BoldInside')} and ${code(false)} words. ${index}. `);
  }
  const maker = engine();
  return { after, before, patches: maker.patch_make(after, before, maker.diff_main(after, before, true)) };
}

// As redo applies them: the other way round, in the other order.
const redoOf = (dmp, patches) => {
  const redo = dmp.patch_deepCopy(patches).reverse();
  for (const patch of redo) for (const diff of patch.diffs) diff[0] = -diff[0];
  return redo;
};

test('many patches across a large document are applied at once, undoing and redoing', () => {
  const { after, before, patches } = highlighted(900000);
  assert.ok(patches.length > 500, String(patches.length));
  const dmp = engine();
  const began = performance.now();
  const [undone, results] = dmp.patch_apply(patches, after);
  const [redone, redoResults] = dmp.patch_apply(redoOf(dmp, patches), before);
  const took = performance.now() - began;
  assert.equal(undone, before);
  assert.ok(results.every(Boolean));
  assert.equal(redone, after);
  assert.ok(redoResults.every(Boolean));
  assert.ok(took < 100, `${Math.round(took)} ms`);
});

test('many patches across a document are applied as the library applies them', () => {
  const { after, before, patches } = highlighted(100000);
  const dmp = engine();
  const [undone, results] = dmp.patch_apply(patches, after);
  assert.equal(undone, before);
  assert.ok(results.every(Boolean));
  const [theirs, theirResults] = new DMP().patch_apply(patches, after);
  assert.equal(theirs, before);
  assert.ok(theirResults.every(Boolean));
  const library = new DMP();
  const [redone] = dmp.patch_apply(redoOf(dmp, patches), before);
  const [theirsRedone] = library.patch_apply(redoOf(library, patches), before);
  assert.equal(redone, after);
  assert.equal(theirsRedone, after);
});

test('a patch whose surroundings changed is placed as the library places it', () => {
  const before = paragraph('one two three') + paragraph('four five six') + paragraph('seven eight nine');
  const after = paragraph('one TWO three') + paragraph('four FIVE six') + paragraph('seven EIGHT nine');
  const dmp = engine();
  const patches = dmp.patch_make(after, before, dmp.diff_main(after, before, true));
  // The text differs from the one the patches were made for, in the middle of a patch.
  const moved = after.replace('one TW', 'one TWIDDLY');
  const [ours, ourResults] = dmp.patch_apply(patches, moved);
  const [theirs, theirResults] = new DMP().patch_apply(patches, moved);
  assert.equal(ours, theirs);
  assert.deepEqual(ourResults, theirResults);
  // And where they are expected.
  const [exact, exactResults] = dmp.patch_apply(patches, after);
  assert.equal(exact, before);
  assert.ok(exactResults.every(Boolean));
});

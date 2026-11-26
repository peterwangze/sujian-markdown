import { diffParts } from './markdown-edits.js';

const equal = 0;
const insert = 1;
const remove = -1;
// As diff-match-patch groups them: changes less than two margins apart share a patch.
const margin = 4;
const contextLimit = 24;
const nearby = 4000;
const bound = nearby + 64;

// The text after the current place once the remaining patches are applied.
function following(diffs, index) {
  let text = '';
  for (; index < diffs.length && text.length < nearby + contextLimit * 2; index += 1) {
    if (diffs[index][0] !== insert) text += diffs[index][1];
  }
  return text;
}

// Changes less than two margins apart share one patch, as diff-match-patch
// builds them. Its context is read from the text with the patches before it
// applied, where undo and redo expect to find it. The context grows until it
// is unique near the change; looking further would cost a scan of the whole
// editor for every patch.
function patches(text, diffs) {
  const result = [];
  let patch = null;
  let base = '';
  let end = 0;
  let count1 = 0;
  let count2 = 0;
  let behind = '';
  for (let index = 0; index < diffs.length; index += 1) {
    const [type, value] = diffs[index];
    if (!patch && type !== equal) {
      patch = { diffs: [], start1: count1, start2: count2, length1: 0, length2: 0 };
      base = behind;
    }
    if (type === equal) {
      if (patch && value.length <= 2 * margin && index < diffs.length - 1) {
        patch.diffs.push([type, value]);
        patch.length1 += value.length;
        patch.length2 += value.length;
        end = index + 1;
      } else if (patch && value.length >= 2 * margin) {
        result.push(withContext(base, following(diffs, index), patch));
        // Our patch lists have a rolling context.
        patch = null;
        count1 = count2;
      }
    } else {
      patch.diffs.push([type, value]);
      if (type === insert) patch.length2 += value.length;
      else patch.length1 += value.length;
      end = index + 1;
    }
    if (type !== insert) count1 += value.length;
    if (type !== remove) {
      count2 += value.length;
      behind = value.length >= bound ? value.slice(-bound) : (behind + value).slice(-bound);
    }
  }
  if (patch) result.push(withContext(base, following(diffs, end), patch));
  return result;
}

function withContext(behind, ahead, patch) {
  const own = patch.diffs.filter(([type]) => type !== insert).map(([, value]) => value).join('');
  const view = behind + own + ahead;
  const at = behind.length;
  let padding = 0;
  let pattern = own;
  while (pattern.length < contextLimit && (view && !pattern ||
    view.indexOf(pattern, at - padding - nearby) !== view.lastIndexOf(pattern, at + own.length + padding + nearby))) {
    padding += margin;
    pattern = behind.slice(-padding) + own + ahead.slice(0, padding);
  }
  padding += margin;
  const head = behind.slice(-padding);
  const tail = ahead.slice(0, padding);
  if (head) patch.diffs.unshift([equal, head]);
  patch.start1 -= head.length;
  patch.start2 -= head.length;
  patch.length1 += head.length;
  patch.length2 += head.length;
  if (tail) patch.diffs.push([equal, tail]);
  patch.length1 += tail.length;
  patch.length2 += tail.length;
  return patch;
}

// Each patch lies where it says when the text is the one it was made from,
// as it is for undo and redo. The library looks for its patches with a fuzzy
// search that takes time in proportion to the place in the document, and
// copies the whole text for each of them: undoing one key at the end of a
// large document took seconds. Returns null when anything is not as expected,
// and the library applies the patches.
//
// A place is counted with the patches before it in the document applied.
// Undo goes along the document, starting from the newer text, and needs those
// patches to move it. Redo comes back the other way, starting from the older
// text, where each lies at its place already. Where the text repeats itself
// the other reading can seem to fit as well, so the order of the list decides
// which is tried first.
function appliedExactly(dmp, patches, text) {
  const list = patches.map((patch) => ({
    at: patch.start2,
    pattern: dmp.diff_text1(patch.diffs),
    replacement: dmp.diff_text2(patch.diffs),
  }));
  // What the patches change in length, in the order of the places they end.
  const ends = list.map((item) => [item.at + item.replacement.length, item.replacement.length - item.pattern.length])
    .sort((left, right) => left[0] - right[0]);
  const sums = [0];
  for (const [, change] of ends) sums.push(sums.at(-1) + change);
  // The change in length made by the patches that end at or before a place.
  const moved = (at) => {
    let low = 0;
    let high = ends.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (ends[middle][0] <= at) low = middle + 1;
      else high = middle;
    }
    return sums[low];
  };
  const applied = (undo) => {
    const spans = [];
    for (const item of list) {
      // A patch does not come before itself, though an empty replacement ends where it starts.
      const own = item.replacement.length === 0 ? item.pattern.length : 0;
      const from = item.at - (undo ? moved(item.at) + own : 0);
      if (from < 0 || !text.startsWith(item.pattern, from)) return null;
      spans.push([from, item.pattern.length, item.replacement]);
    }
    spans.sort((left, right) => left[0] - right[0]);
    const result = [];
    let copied = 0;
    for (const [from, length, replacement] of spans) {
      // No two patches stand on the same text.
      if (from < copied) return null;
      result.push(text.slice(copied, from), replacement);
      copied = from + length;
    }
    result.push(text.slice(copied));
    return result.join('');
  };
  // Redo lists the patches the other way round along the document.
  const backward = list.length > 1 && list.at(-1).at < list[0].at;
  for (const undo of backward ? [false, true] : [true, false]) {
    const result = applied(undo);
    if (result !== null) return [result, patches.map(() => true)];
  }
  return null;
}

// Vditor records each undo step as the editor HTML with a marker at the
// caret. It copies the whole editor for that, and restores the selection from
// a saved range afterwards. Chromium leaves the caret where it is when the
// marker is inserted and removed, so the marker is read from the editor
// itself. Rendered diagrams are left to Vditor, which replaces them by their
// source in the copy it needs for that.
const rendered = '.vditor-ir__preview[data-render="1"] > .language-echarts, .vditor-ir__preview[data-render="1"] > .language-plantuml,' +
  ' .vditor-ir__preview[data-render="1"] > .language-mindmap, .vditor-ir__preview[data-render="1"] > .language-math';
function snapshot(copy, vditor) {
  const editor = vditor[vditor.currentMode].element;
  if (vditor.currentMode !== 'ir' || editor.querySelector(rendered)) return copy(vditor, false);
  const selection = window.getSelection();
  let marked = false;
  if (selection.rangeCount !== 0 && !editor.querySelector('wbr')) {
    const range = selection.getRangeAt(0);
    if (editor.contains(range.startContainer)) {
      const marker = document.createElement('span');
      marker.className = 'vditor-wbr';
      range.insertNode(marker);
      marked = true;
    }
  }
  const html = editor.innerHTML;
  if (marked) editor.querySelectorAll('.vditor-wbr').forEach((item) => item.remove());
  return marked ? html.replace('<span class="vditor-wbr"></span>', '<wbr>') : html;
}

// Vditor rebuilds the [TOC] blocks from every heading of the editor on each
// input. Documents without such a block are spared that work.
function servesToc(editor) {
  const element = editor.preview.element.style.display === 'block' ? editor.preview.previewElement : editor[editor.currentMode].element;
  return element.querySelector('[data-type="toc-block"]') !== null;
}

// Removes the work Vditor does for the whole editor while its text changes:
// undo steps found with diff-match-patch, whose patch builder copies the
// whole editor HTML once per changed place and whose application searches
// for every patch, undo snapshots that copy the editor, and the table of
// contents.
export function speedUpLiveEngine(vditor) {
  const { undo, outline } = vditor;
  const dmp = undo.dmp;
  const patchMake = dmp.patch_make;
  dmp.diff_main = (before, after) => diffParts(before, after).map((part) => [part.added ? insert : part.removed ? remove : equal, part.value]);
  dmp.patch_make = (before, after, diffs) => diffs ? patches(before, diffs) : patchMake.call(dmp, before, after);
  const patchApply = dmp.patch_apply;
  dmp.patch_apply = (list, text) => appliedExactly(dmp, list, text) ?? patchApply.call(dmp, list, text);

  const copy = undo.addCaret;
  undo.addCaret = (editor) => snapshot(copy, editor);

  const render = outline.render;
  outline.render = function (editor) {
    return servesToc(editor) ? render.call(this, editor) : '';
  };
}

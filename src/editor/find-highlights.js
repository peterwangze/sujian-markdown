import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';

export const setSourceSearchMatches = StateEffect.define();
const sourceMatches = StateField.define({
  create: () => null,
  update(current, transaction) {
    const change = transaction.effects.find(effect => effect.is(setSourceSearchMatches));
    return change ? change.value : transaction.docChanged ? null : current;
  },
});
const sourceMark = Decoration.mark({ class: 'editor-find-match' });
const sourceCurrentMark = Decoration.mark({ class: 'editor-find-current' });

function firstIndex(items, predicate) {
  let start = 0;
  let end = items.length;
  while (start < end) {
    const middle = (start + end) >>> 1;
    if (predicate(items[middle])) end = middle;
    else start = middle + 1;
  }
  return start;
}

function visibleSourceMatches(view) {
  const search = view.state.field(sourceMatches);
  if (!search) return Decoration.none;
  const marks = [];
  for (const visible of view.visibleRanges) {
    const start = firstIndex(search.matches, match => match.index + match[0].length > visible.from);
    for (let i = start; i < search.matches.length; i++) {
      const match = search.matches[i];
      if (match.index >= visible.to) break;
      const from = Math.max(visible.from, match.index);
      const to = Math.min(visible.to, match.index + match[0].length);
      if (to > from) marks.push((i === search.index ? sourceCurrentMark : sourceMark).range(from, to));
    }
  }
  return Decoration.set(marks, true);
}

export const sourceFindHighlights = [sourceMatches, ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = visibleSourceMatches(view); }

  update(update) {
    if (update.viewportChanged || update.startState.field(sourceMatches) !== update.state.field(sourceMatches)) {
      this.decorations = visibleSourceMatches(update.view);
    }
  }
}, { decorations: value => value.decorations })];

export function findTextRange(ranges, from, to) {
  const start = ranges[firstIndex(ranges, range => range.to > from)] ?? ranges.at(-1);
  if (!start) return null;
  const range = start.node.ownerDocument.createRange();
  range.setStart(start.node, Math.max(0, Math.min(start.node.length, from - start.from)));
  if (from === to) return range;
  const end = ranges[firstIndex(ranges, item => item.to >= to)] ?? ranges.at(-1);
  if (end.to < from || start.from >= to) return null;
  range.setEnd(end.node, Math.max(0, Math.min(end.node.length, to - end.from)));
  return range;
}

export function setRenderedSearchMatches(ranges = [], matches = [], current = -1) {
  const registry = globalThis.CSS?.highlights;
  if (!registry || !globalThis.Highlight) return;
  const others = new Highlight();
  const selected = new Highlight();
  selected.priority = 1;
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    if (!match[0].length) continue;
    const end = match.index + match[0].length;
    const highlight = index === current ? selected : others;
    const start = firstIndex(ranges, range => range.to > match.index);
    for (let part = start; part < ranges.length && ranges[part].from < end; part++) {
      const { node, from, to } = ranges[part];
      const range = node.ownerDocument.createRange();
      range.setStart(node, Math.max(0, match.index - from));
      range.setEnd(node, Math.min(end, to) - from);
      highlight.add(range);
    }
  }
  for (const [name, highlight] of [['sujian-find-match', others], ['sujian-find-current', selected]]) {
    if (highlight.size) registry.set(name, highlight);
    else registry.delete(name);
  }
}

import { applyMarkdownChanges, diffRanges } from './markdown-edits.js';

const neighbours = 2;
const chunkSize = 150;
const maxGap = 8;
const crlfOnly = /(?:^|[^\r])\n|\r(?!\n)/;
const trimNewlines = (text) => text.replace(/\n+$/, '');
// Attributes Lute reads when it turns the editor DOM into Markdown.
const luteAttributes = new Set(['align', 'alt', 'checked', 'class', 'data-marker', 'data-render', 'data-task', 'data-tight',
  'data-type', 'href', 'src', 'start', 'style', 'title']);
const source = (node) => node.nodeType === 1 ? node.outerHTML
  : node.data.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const eager = { timeRemaining: () => Infinity };
// Vditor marks the caret in the editor before it takes an undo snapshot.
export const isCaretMarker = (record) => record.type === 'childList' && record.addedNodes.length + record.removedNodes.length > 0 &&
  [...record.addedNodes, ...record.removedNodes].every((node) => node.className === 'vditor-wbr');

// Keeps the Markdown of the live editor current without converting the whole
// document for every keystroke. Only the edited top-level blocks and their
// neighbours are converted again and spliced into the previous Markdown, and
// the document text keeps its original formatting through the same projection
// as larger edits.
//
// The estimate is checked against a whole-document conversion whenever the
// document is saved, searched or switched. A mismatch never reaches the
// document on its own: the text is then recomputed from the last confirmed
// state, exactly as a whole-document conversion would, and the document keeps
// using those.
export function createLiveModel({ element, convert, idle, cancel }) {
  let raw = '';            // Document text with LF line breaks
  let crlf = false;        // The document uses CRLF line breaks throughout
  let md = '';             // Markdown of the DOM at the last update
  let ranges = [];         // Normalisation ranges between raw and md
  let base = null;         // Last { raw, md, ranges } confirmed by a whole conversion
  let blocks = [];         // Top-level nodes of the DOM at the last update
  let origin = null;       // HTML of the top-level nodes as they were when the document was loaded
  let spans = null;        // Map(node → { from, to }) in md
  let indexed = 0;         // Nodes of `blocks` passed by the index so far, in list order
  let ticket = 0;
  let pending;
  const dirty = new Set(); // Nodes changed in place since the last update
  const known = new WeakMap(); // Nodes and the HTML they had when their Markdown in md was found
  let state = 'empty';     // empty → ready → whole

  // The Markdown of the editor as it was loaded. The editor may have changed
  // since; those changes are edits on top of it, like any other.
  function prepare() {
    if (!origin) origin = new Map(Array.from(element.childNodes, (node) => [node, source(node)]));
    blocks = [...origin.keys()];
    md = convert([...origin.values()].join(''));
    ranges = diffRanges(raw, md);
    base = { raw, md, ranges };
    spans = null;
    indexed = 0;
    // Lute nests everything that follows an indented code block inside that
    // block, which changes the line breaks the later blocks are given.
    state = blocks.some((node) => /^(?:code|math)-block$/.test(node.dataset?.type ?? '') &&
      !String(node.firstChild?.getAttribute?.('data-type') ?? '').includes('-block-open-marker')) ? 'whole' : 'ready';
  }

  // Finds the Markdown of a node in md after `search` and returns where it
  // ends. After a node that could not be located, the text of that node lies
  // in between, so the next one is looked up at the start of a line.
  function locate(node, search, skipped) {
    const html = origin?.get(node) ?? source(node);
    const content = trimNewlines(convert(html));
    const found = skipped && search > 0 ? md.indexOf('\n' + content, search - 1) + 1 : md.indexOf(content, search);
    if (found < search || (!skipped && found - search > maxGap)) return -1;
    spans.set(node, { from: found, to: found + content.length });
    known.set(node, html);
    return found + content.length;
  }

  // Locates the nodes the index has not passed yet while there is time.
  function indexMore(deadline) {
    let search = 0;
    let skipped = false;
    for (let index = indexed; index > 0; index -= 1) {
      const span = spans.get(blocks[index - 1]);
      if (span) {
        search = span.to;
        break;
      }
      skipped = true;
    }
    do {
      for (const end = Math.min(blocks.length, indexed + chunkSize); indexed < end; indexed += 1) {
        const node = blocks[indexed];
        const span = spans.get(node);
        if (span) {
          search = span.to;
          skipped = false;
        } else if (origin || (node.isConnected && !dirty.has(node))) {
          // Without the loaded HTML, a node edited before it was located has lost its earlier Markdown.
          const found = locate(node, search, skipped);
          if (found < 0) skipped = true;
          else {
            search = found;
            skipped = false;
          }
        } else skipped = true;
      }
    } while (indexed < blocks.length && deadline.timeRemaining() > 8);
    if (indexed >= blocks.length) origin = null;
  }

  function startIndexed() {
    spans = new Map();
    indexed = 0;
  }

  function ensureIndexed() {
    if (spans === null) startIndexed();
    cancel(pending);
    ticket += 1;
    indexMore(eager);
  }

  function schedule() {
    cancel(pending);
    const current = ++ticket;
    const step = (deadline) => {
      if (current !== ticket) return;
      if (state === 'empty') prepare();
      if (state !== 'ready') return;
      if (spans === null) startIndexed();
      indexMore(deadline);
      if (indexed < blocks.length) pending = idle(step);
    };
    pending = idle(step);
  }

  // Converts the whole document once the first change or request arrives
  // before the browser was idle.
  function settle() {
    if (state !== 'empty') return;
    cancel(pending);
    prepare();
    if (state === 'ready') schedule();
  }

  // A whole-document conversion of the DOM.
  function replace(next) {
    const changed = next !== md;
    if (changed) {
      raw = applyMarkdownChanges(raw, md, ranges, diffRanges(md, next));
      md = next;
      ranges = diffRanges(raw, md);
    }
    base = { raw, md, ranges };
    blocks = Array.from(element.childNodes);
    origin = null;
    dirty.clear();
    spans = null;
    indexed = 0;
    return changed;
  }

  function whole() {
    return replace(convert(element.innerHTML));
  }

  function toRaw(offset) {
    let adjustment = 0;
    for (const range of ranges) {
      if (range.endAfter > offset) break;
      adjustment = range.endBefore - range.endAfter;
    }
    return offset + adjustment;
  }

  function update() {
    const current = Array.from(element.childNodes);
    const total = current.length;
    const previous = blocks.length;
    const limit = Math.min(previous, total);
    let start = 0;
    let endBefore = previous;
    let end = total;
    while (start < limit && blocks[start] === current[start]) start += 1;
    while (endBefore > start && end > start && blocks[endBefore - 1] === current[end - 1]) {
      endBefore -= 1;
      end -= 1;
    }
    if (start === end && endBefore === start && !dirty.size) return false;

    const shift = total - previous;
    ensureIndexed();
    // The index follows the nodes it has passed when blocks were inserted or removed.
    if (indexed > endBefore) indexed = Math.min(total, indexed + shift);
    else if (indexed > start) indexed = start;

    // Vditor rebuilds blocks around an edit and moves link references and
    // footnotes to the end on every input. A rebuilt block counts as unchanged
    // while it still converts to the same Markdown.
    const spanOf = (index) => spans.get(blocks[index < start ? index : index - shift]);
    const moves = [];
    // `before` and `after` are the same block in the old and the new list.
    const rebuilt = (before, after) => {
      const span = spans.get(before);
      if (!before || before.isConnected || !span) return false;
      const html = source(current[after]);
      // Undo and redo build the whole editor again. A node that is the HTML it
      // was when its Markdown was found has that Markdown still.
      if (known.get(before) !== html && trimNewlines(convert(html)) !== md.slice(span.from, span.to)) return false;
      moves.push([before, current[after]]);
      known.set(current[after], html);
      return true;
    };
    while (start < endBefore && start < end && rebuilt(blocks[start], start)) start += 1;
    while (endBefore > start && end > start && rebuilt(blocks[endBefore - 1], end - 1)) {
      endBefore -= 1;
      end -= 1;
    }

    // Blocks edited in place (a checkbox, text Vditor left alone) are changed runs of their own.
    const runs = start < end || start < endBefore ? [[start, Math.max(start, end)]] : [];
    if (dirty.size) {
      const positions = dirty.size > 1 ? new Map(current.map((node, index) => [node, index])) : null;
      for (const node of dirty) {
        if (node.parentNode !== element) continue;
        const index = positions ? positions.get(node) : current.indexOf(node);
        if (index < 0 || (index >= start && index < end)) continue;
        runs.push([index, index + 1]);
      }
    }
    dirty.clear();
    runs.sort((left, right) => left[0] - right[0]);
    const merged = [];
    for (const run of runs) {
      const last = merged.at(-1);
      if (last && run[0] - last[1] <= 2 * neighbours) last[1] = Math.max(last[1], run[1]);
      else merged.push(run);
    }

    let changed = false;
    // From the end, so that the Markdown before each run keeps its offsets.
    for (const [runStart, runEnd] of merged.reverse()) {
      const result = splice(current, total, runStart, runEnd, spanOf);
      if (result === null) return whole() || changed;
      changed = result || changed;
    }
    for (const node of blocks.slice(start, endBefore)) spans.delete(node);
    for (const [before, after] of moves) {
      const span = spans.get(before);
      spans.delete(before);
      if (span && !spans.has(after)) spans.set(after, span);
    }
    blocks = current;
    return changed;
  }

  // Converts `neighbours` blocks around a run again and splices the result
  // into md and raw. Returns whether the Markdown changed, or null when the
  // result would differ from a whole-document conversion.
  function splice(current, total, runStart, runEnd, spanOf) {
    const lo = Math.max(0, runStart - neighbours);
    const hi = Math.min(total, runEnd + neighbours);
    const from = lo === 0 ? 0 : spanOf(lo)?.from;
    const to = hi === total ? md.length : spanOf(hi - 1)?.to;
    if (from === undefined || to === undefined) return null;
    const html = new Array(hi - lo);
    for (let index = lo; index < hi; index += 1) html[index - lo] = source(current[index]);
    const piece = hi === total ? convert(html.join('')) : trimNewlines(convert(html.join('')));
    const before = md.slice(from, to);

    // The unchanged blocks around the run must convert to what they did before.
    const next = new Array(hi - lo);
    let search = 0;
    for (let index = lo; index < runStart; index += 1) {
      const span = spanOf(index);
      if (!span) return null;
      next[index - lo] = { from: span.from - from, to: span.to - from };
      search = span.to - from;
    }
    if (runStart > lo && piece.slice(0, search) !== md.slice(from, from + search)) return null;
    for (let index = runStart; index < runEnd; index += 1) {
      const content = trimNewlines(convert(source(current[index])));
      const found = piece.indexOf(content, search);
      if (found < 0 || found - search > maxGap) return null;
      next[index - lo] = { from: found, to: found + content.length };
      search = found + content.length;
    }
    if (runEnd < hi) {
      const start = spanOf(runEnd)?.from;
      if (start === undefined) return null;
      const tail = md.slice(start, to);
      const offset = piece.length - tail.length - start;
      if (search > piece.length - tail.length || !piece.endsWith(tail)) return null;
      for (let index = runEnd; index < hi; index += 1) {
        const span = spanOf(index);
        next[index - lo] = { from: span.from + offset, to: span.to + offset };
      }
    }

    if (piece !== before) {
      // Widen the edited Markdown so that no normalisation range crosses its edges.
      const first = ranges.findIndex((range) => range.endAfter > from);
      const last = ranges.findIndex((range) => range.after >= to);
      const touching = first >= 0 && first < last;
      const lead = touching && ranges[first].after < from ? ranges[first].after : from;
      const rear = touching && ranges[last - 1].endAfter > to ? ranges[last - 1].endAfter : to;
      const rawFrom = toRaw(lead);
      const rawTo = toRaw(rear);
      const oldText = md.slice(lead, rear);
      const newText = md.slice(lead, from) + piece + md.slice(to, rear);
      const oldRaw = raw.slice(rawFrom, rawTo);
      const local = diffRanges(oldRaw, oldText);
      const newRaw = applyMarkdownChanges(oldRaw, oldText, local, diffRanges(oldText, newText));
      const rawShift = newRaw.length - oldRaw.length;
      const mdShift = newText.length - oldText.length;
      ranges = [
        ...ranges.slice(0, first < 0 ? ranges.length : first),
        ...local.map((range) => ({ ...range, before: range.before + rawFrom, endBefore: range.endBefore + rawFrom, after: range.after + lead, endAfter: range.endAfter + lead })),
        ...ranges.slice(last < 0 ? ranges.length : last).map((range) => ({ ...range, before: range.before + rawShift, endBefore: range.endBefore + rawShift, after: range.after + mdShift, endAfter: range.endAfter + mdShift })),
      ];
      raw = raw.slice(0, rawFrom) + newRaw + raw.slice(rawTo);
      md = md.slice(0, from) + piece + md.slice(to);
      const delta = piece.length - before.length;
      for (const span of spans.values()) {
        if (span.from < to) continue;
        span.from += delta;
        span.to += delta;
      }
    }
    for (let index = lo; index < hi; index += 1) {
      const span = next[index - lo];
      spans.set(current[index], { from: span.from + from, to: span.to + from });
      known.set(current[index], html[index - lo]);
    }
    return piece !== before;
  }

  return {
    reset(text) {
      cancel(pending);
      ticket += 1;
      crlf = text.includes('\r\n') && !crlfOnly.test(text);
      raw = crlf ? text.replaceAll('\r\n', '\n') : text;
      state = 'empty';
      base = null;
      dirty.clear();
      origin = new Map(Array.from(element.childNodes, (node) => [node, source(node)]));
      schedule();
    },
    observe(records) {
      for (const record of records) {
        // Only attributes Lute reads can change the Markdown.
        if (record.type === 'attributes' && !luteAttributes.has(record.attributeName)) continue;
        // Expanding an inline node for reading does not change its Markdown.
        // A class that was added has no earlier value, and an SVG element's
        // classes are not a string.
        const classes = record.target.getAttribute?.('class') ?? '';
        if (record.attributeName === 'class' && record.oldValue !== undefined &&
          String(record.oldValue ?? '').replace(' vditor-ir__node--expand', '') === String(classes).replace(' vditor-ir__node--expand', '')) continue;
        if (isCaretMarker(record)) continue;
        // Blocks added or removed have no node to mark.
        if (record.target === element) dirty.add(element);
        for (let node = record.target; node; node = node.parentNode) {
          if (node.parentNode === element) {
            dirty.add(node);
            known.delete(node);
            break;
          }
          // Lute skips rendered previews.
          if (/^[12]$/.test(node.dataset?.render ?? '')) break;
        }
      }
    },
    dispose() {
      cancel(pending);
      ticket += 1;
    },
    // The Markdown of the editor, converted in full only when nothing asked for it yet.
    // Callers bring the model up to date with `flush` first.
    text() {
      settle();
      return md;
    },
    // Returns the document text when it changed, otherwise null. `authoritative`
    // is a whole-document conversion of the DOM; `verify` requests one.
    flush(authoritative, verify = false) {
      if (state === 'empty') {
        // Nothing has changed in the editor since the document was loaded.
        if (typeof authoritative !== 'string' && !dirty.size) return null;
        settle();
      }
      let changed = state === 'whole' ? replace(convert(element.innerHTML)) : update();
      if (verify && state !== 'whole' && base.md !== md) authoritative = convert(element.innerHTML);
      if (typeof authoritative === 'string' && authoritative !== md) {
        const text = applyMarkdownChanges(base.raw, base.md, base.ranges, diffRanges(base.md, authoritative));
        changed = text !== raw || changed;
        raw = text;
        md = authoritative;
        ranges = diffRanges(raw, md);
        base = { raw, md, ranges };
        state = 'whole';
      } else if (typeof authoritative === 'string') base = { raw, md, ranges };
      return changed ? (crlf ? raw.replaceAll('\n', '\r\n') : raw) : null;
    },
  };
}

// Vditor converts the whole editor whenever it needs its Markdown: after a
// pause in typing and for getValue(). The model holds the same text without
// that conversion, so those requests are answered from it; the model keeps
// converting the editor itself, which is what checks its estimates. `read`
// brings the model up to date and returns its text, or null when the document
// is not following the model. Returns whether a text came from here.
export function serveMarkdown(vditor, read) {
  const lute = vditor.lute;
  const convert = lute.VditorIRDOM2Md;
  let reading = false;
  let served = null;
  lute.VditorIRDOM2Md = function (html) {
    if (reading || html !== vditor.ir.element.innerHTML) return convert.call(lute, html);
    reading = true;
    try {
      served = read();
    } finally {
      reading = false;
    }
    return served ?? convert.call(lute, html);
  };
  return (text) => text !== undefined && text === served;
}

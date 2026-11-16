import { diffArrays } from 'diff'

const MAX_INLINE_LENGTH = 4_096
const MAX_INLINE_LINES = 24
const MAX_EDIT_DISTANCE = 64
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function appendSpan(spans, text, changed) {
  if (!text) return
  const last = spans.at(-1)
  if (last?.changed === changed) last.text += text
  else spans.push({ text, changed })
}

function appendWhole(result, before, after) {
  const changed = before !== after
  appendSpan(result.before, before, changed)
  appendSpan(result.after, after, changed)
}

function tokenize(text) {
  const tokens = []
  let previousKind = ''
  const leadingEnd = text.length - text.trimStart().length
  const trailingStart = text.trimEnd().length
  for (const { segment, index } of graphemes.segment(text)) {
    // Words and numbers read as units in code; punctuation and CJK remain granular.
    const kind = /^\p{Script=Latin}\p{Mark}*$/u.test(segment) ? 'word' : /^\p{Decimal_Number}$/u.test(segment) ? 'number' : ''
    // Indentation and trailing spaces should never match each other across a line's text.
    const edge = /^[\t ]$/.test(segment) && (index < leadingEnd ? 'start' : index >= trailingStart ? 'end' : '')
    if (kind && kind === previousKind) tokens[tokens.length - 1].text += segment
    else tokens.push({ text: segment, edge })
    previousKind = kind
  }
  return tokens
}

function contentLength(tokens) {
  return tokens.reduce((count, token) => count + Number(/\S/u.test(token.text)), 0)
}

function similarEnough(parts, oldTokens, newTokens) {
  const smaller = Math.min(contentLength(oldTokens), contentLength(newTokens))
  if (smaller <= 2) return true
  // Ignore matches made only of spacing when judging whether a replacement is related.
  const shared = parts.reduce((count, part) => part.added || part.removed ? count : count + contentLength(part.value), 0)
  return shared * 2 >= smaller
}

function appendComparison(result, before, after) {
  if (!before || !after || before === after) {
    appendWhole(result, before, after)
    return
  }

  const oldTokens = tokenize(before)
  const newTokens = tokenize(after)
  const parts = diffArrays(oldTokens, newTokens, {
    comparator: (oldToken, newToken) => oldToken.text === newToken.text && oldToken.edge === newToken.edge,
    maxEditLength: MAX_EDIT_DISTANCE,
  })
  if (!parts || !similarEnough(parts, oldTokens, newTokens)) {
    appendWhole(result, before, after)
    return
  }

  for (const part of parts) {
    const text = part.value.map(token => token.text).join('')
    if (!part.added) appendSpan(result.before, text, Boolean(part.removed))
    if (!part.removed) appendSpan(result.after, text, Boolean(part.added))
  }
}

/** Build display spans without changing either side's original text. */
export function buildInlineDiff(before, after) {
  const result = { before: [], after: [] }
  if (!before || !after || before === after || before.length + after.length > MAX_INLINE_LENGTH) {
    appendWhole(result, before, after)
    return result
  }

  const linePattern = /[^\r\n]+(?:\r\n|[\r\n])?|\r\n|[\r\n]/g
  const oldLines = before.match(linePattern)
  const newLines = after.match(linePattern)
  if (Math.max(oldLines.length, newLines.length) > MAX_INLINE_LINES) {
    appendWhole(result, before, after)
  } else if (oldLines.length !== newLines.length) {
    // Keep common text when a replacement also inserts or removes a line.
    appendComparison(result, before, after)
  } else {
    for (let index = 0; index < oldLines.length; index++) {
      appendComparison(result, oldLines[index], newLines[index])
    }
  }
  return result
}

import { diffArrays } from 'diff'

const MAX_TEXT_LENGTH = 2_000_000
const MAX_LINE_COUNT = 80_000
const MAX_REVIEW_CHANGES = 2_000
const DIFF_TIMEOUT_MS = 100
const MAX_EDIT_DISTANCE = 12_000

function reviewLimit() {
  return new RangeError('文档太大或差异过多，无法安全完成比较。请缩小审阅范围。')
}

function splitLines(text) {
  // Delimiters are part of their lines so CRLF, mixed endings and EOF survive exact edits.
  const lines = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? []
  if (lines.at(-1) === '') lines.pop()
  if (lines.length > MAX_LINE_COUNT) throw reviewLimit()
  return lines
}

function changedRanges(base, text, baseLines) {
  if (base === text) return []
  const parts = diffArrays(baseLines, splitLines(text), {
    timeout: DIFF_TIMEOUT_MS,
    maxEditLength: MAX_EDIT_DISTANCE,
  })
  if (!parts) throw reviewLimit()

  const ranges = []
  let sourceOffset = 0
  let targetOffset = 0
  let line = 1
  let pending = null

  function finishRange() {
    if (!pending) return
    ranges.push({ ...pending, end: sourceOffset, targetEnd: targetOffset })
    pending = null
    if (ranges.length > MAX_REVIEW_CHANGES) throw reviewLimit()
  }

  for (const part of parts) {
    const length = part.value.reduce((total, value) => total + value.length, 0)
    if (part.removed || part.added) {
      pending ??= { start: sourceOffset, targetStart: targetOffset, line }
    } else {
      finishRange()
    }
    if (!part.added) {
      sourceOffset += length
      line += part.count
    }
    if (!part.removed) targetOffset += length
  }
  finishRange()
  return ranges
}

function precedes(left, right) {
  if (left.end !== right.start) return left.end < right.start
  // An insertion at either edge of a replacement may change how the lines fit together.
  return left.start !== left.end && right.start !== right.end
}

/** Compare proposed changes against a fixed base and the latest editor contents. */
export function buildReview(baseText, currentText, candidateText) {
  for (const text of [baseText, currentText, candidateText]) {
    if (typeof text !== 'string') throw new TypeError('审阅需要原稿、当前稿和候选稿文本。')
    if (text.length > MAX_TEXT_LENGTH) throw reviewLimit()
  }

  const baseLines = splitLines(baseText)
  const proposed = changedRanges(baseText, candidateText, baseLines)
  let local = proposed
  if (proposed.length && currentText !== candidateText) local = changedRanges(baseText, currentText, baseLines)
  let nextLocal = 0

  const changes = proposed.map((change, index) => {
    while (nextLocal < local.length && precedes(local[nextLocal], change)) nextLocal++
    let endLocal = nextLocal
    while (endLocal < local.length && !precedes(change, local[endLocal])) endLocal++

    const before = baseText.slice(change.start, change.end)
    const after = candidateText.slice(change.targetStart, change.targetEnd)
    const first = local[nextLocal]
    const last = local[endLocal - 1]
    let status = 'ready'
    let from
    let to

    if (endLocal === nextLocal) {
      const preceding = local[nextLocal - 1]
      const offset = preceding ? preceding.targetEnd - preceding.end : 0
      from = change.start + offset
      to = change.end + offset
    } else {
      // Include the whole overlapping edit when its replacement spans the proposed range's edge.
      from = Math.min(change.start, first.start) + first.targetStart - first.start
      to = Math.max(change.end, last.end) + last.targetEnd - last.end
      status = endLocal === nextLocal + 1 && first.start === change.start && first.end === change.end &&
        currentText.slice(from, to) === after ? 'already-applied' : 'conflict'
    }

    return Object.freeze({
      id: `change-${index + 1}`,
      line: change.line,
      before,
      after,
      current: currentText.slice(from, to),
      status,
      from,
      to,
    })
  })

  return Object.freeze({ baseText, currentText, candidateText, changes: Object.freeze(changes) })
}

/** Apply the selected changes to the current snapshot used to build the review. */
export function applyReview(review, selectedIds) {
  const pending = new Set(selectedIds)
  const segments = []
  let cursor = 0

  for (const change of review.changes) {
    if (!pending.delete(change.id)) continue
    if (change.status !== 'ready') throw new Error('所选改动已发生冲突或已经应用。')
    segments.push(review.currentText.slice(cursor, change.from), change.after)
    cursor = change.to
  }
  if (pending.size) throw new Error('所选改动不属于当前审阅。')

  segments.push(review.currentText.slice(cursor))
  return segments.join('')
}

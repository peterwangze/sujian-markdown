import assert from 'node:assert/strict'
import { setTimeout } from 'node:timers/promises'

export async function waitForCheck(description, check, timeout = 10000) {
  const deadline = Date.now() + timeout
  do {
    if (await check()) return
    await setTimeout(50)
  } while (Date.now() < deadline)
  assert.fail(description)
}

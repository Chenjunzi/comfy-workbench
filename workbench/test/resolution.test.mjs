import test from 'node:test'
import assert from 'node:assert/strict'
import { stepResolution } from '../shared/resolution.mjs'

test('resolution steps preserve exact ratio, alignment and bounds', () => {
  assert.deepEqual(stepResolution(720, 1280, 1), { width: 792, height: 1408 })
  assert.deepEqual(stepResolution(792, 1408, -1), { width: 720, height: 1280 })
  for (const [width, height, alignment] of [[480, 832, 8], [1184, 896, 16], [1024, 1024, 16], [1280, 720, 8]]) {
    const next = stepResolution(width, height, 1, alignment, 4096)
    assert.equal(next.width * height, next.height * width)
    assert.equal(next.width % alignment, 0)
    assert.equal(next.height % alignment, 0)
  }
  assert.equal(stepResolution(2048, 2048, 1), null)
  assert.equal(stepResolution(64, 64, -1), null)
})

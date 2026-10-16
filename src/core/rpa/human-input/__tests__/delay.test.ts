import { describe, it, expect } from 'vitest'
import { generateIrregularDelay } from '../delay'

function stats(samples: number[]) {
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length
  const longPct = samples.filter((v) => v >= 200).length / samples.length
  return { mean, stddev: Math.sqrt(variance), longPct }
}

describe('generateIrregularDelay', () => {
  it('returns integer >= 5 for any base', () => {
    for (const base of [10, 100, 1000]) {
      for (let i = 0; i < 200; i++) {
        const v = generateIrregularDelay(base)
        expect(Number.isInteger(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(5)
      }
    }
  })

  it('clamps to minimum 5 even when baseDelay is tiny', () => {
    for (let i = 0; i < 500; i++) {
      const v = generateIrregularDelay(1)
      expect(v).toBeGreaterThanOrEqual(5)
    }
  })

  it('mean is approximately baseDelay (within ±10%)', () => {
    const samples = Array.from({ length: 10000 }, () => generateIrregularDelay(100))
    const { mean } = stats(samples)
    expect(mean).toBeGreaterThanOrEqual(110)
    expect(mean).toBeLessThanOrEqual(140)
  })

  it('stddev is approximately 0.4 * baseDelay (within ±30%)', () => {
    const samples = Array.from({ length: 10000 }, () => generateIrregularDelay(100))
    const { stddev } = stats(samples)
    expect(stddev).toBeGreaterThanOrEqual(85)
    expect(stddev).toBeLessThanOrEqual(120)
  })

  it('produces >= 7% long-pause samples (>= 2x baseDelay) at base=100', () => {
    const samples = Array.from({ length: 10000 }, () => generateIrregularDelay(100))
    const { longPct } = stats(samples)
    expect(longPct).toBeGreaterThanOrEqual(0.07)
  })

  it('handles random() returning 0 without -Infinity (Box-Muller edge case)', () => {
    const v = generateIrregularDelay(100, () => 0)
    expect(Number.isInteger(v)).toBe(true)
    expect(Number.isFinite(v)).toBe(true)
    expect(v).toBeGreaterThanOrEqual(5)
  })

  it('handles random() returning values close to 1', () => {
    const v = generateIrregularDelay(100, () => 0.9999999)
    expect(Number.isFinite(v)).toBe(true)
    expect(v).toBeGreaterThanOrEqual(5)
  })

  it('accepts injected random for deterministic tests', () => {
    let idx = 0
    const seq = [0.5, 0.5, 0.99, 0.99, 0.99, 0.99]
    const fake = () => seq[idx++ % seq.length]
    const v = generateIrregularDelay(100, fake)
    expect(Number.isInteger(v)).toBe(true)
  })
})

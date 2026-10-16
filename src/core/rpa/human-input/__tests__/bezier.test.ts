import { describe, it, expect } from 'vitest'
import { easeInOut, generateBezierPath } from '../bezier'

function makeSeqFake(seq: number[]) {
  let i = 0
  return () => seq[i++ % seq.length]
}

describe('easeInOut', () => {
  it('maps 0 → 0, 1 → 1, 0.5 → 0.5', () => {
    expect(easeInOut(0)).toBeCloseTo(0)
    expect(easeInOut(1)).toBeCloseTo(1)
    expect(easeInOut(0.5)).toBeCloseTo(0.5)
  })
  it('is monotonically increasing', () => {
    let prev = -1
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeInOut(t)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
  it('matches quadratic ease-in-out formula', () => {
    expect(easeInOut(0.25)).toBeCloseTo(2 * 0.25 * 0.25) // 0.125
    expect(easeInOut(0.75)).toBeCloseTo(1 - Math.pow(-2 * 0.75 + 2, 2) / 2) // 0.875
  })
})

describe('generateBezierPath', () => {
  it('returns empty points when start == end (distance < 1)', () => {
    const r = generateBezierPath(100, 200, 100, 200)
    expect(r.points).toEqual([])
    expect(r.finalX).toBe(100)
    expect(r.finalY).toBe(200)
  })

  it('returns last point exactly at target coords', () => {
    const r = generateBezierPath(0, 0, 500, 300)
    expect(r.points.length).toBeGreaterThan(0)
    const last = r.points[r.points.length - 1]
    expect(last.x).toBe(500)
    expect(last.y).toBe(300)
  })

  it('step count respects minSteps/maxSteps', () => {
    const r = generateBezierPath(0, 0, 1000, 800, { minSteps: 8, maxSteps: 12 })
    expect(r.points.length).toBeGreaterThanOrEqual(8)
    expect(r.points.length).toBeLessThanOrEqual(12)
  })

  it('every point has finite coordinates and integer delay >= 5', () => {
    const r = generateBezierPath(50, 50, 600, 400)
    for (const p of r.points) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
      expect(Number.isInteger(p.delay)).toBe(true)
      expect(p.delay).toBeGreaterThanOrEqual(5)
    }
  })

  it('accepts deterministic fake random and produces same path twice', () => {
    const seq = [0.3, 0.7, 0.1, 0.9, 0.5, 0.5, 0.2, 0.8, 0.4, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5]
    const a = generateBezierPath(0, 0, 200, 200, { random: makeSeqFake([...seq, ...seq]) })
    const b = generateBezierPath(0, 0, 200, 200, { random: makeSeqFake([...seq, ...seq]) })
    expect(a).toEqual(b)
  })

  it('handles negative coordinates', () => {
    const r = generateBezierPath(-100, -100, 100, 100)
    expect(r.points.length).toBeGreaterThan(0)
    const last = r.points[r.points.length - 1]
    expect(last.x).toBe(100)
    expect(last.y).toBe(100)
  })
})

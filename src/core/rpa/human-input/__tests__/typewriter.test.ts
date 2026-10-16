import { describe, it, expect } from 'vitest'
import { typeStringWithDelay } from '../typewriter'

function makeDeps() {
  const chars: string[] = []
  const keys: Array<{ key: string; mods?: string[] }> = []
  const sleeps: number[] = []
  return {
    deps: {
      typeChar: (ch: string) => { chars.push(ch) },
      keyTap: (key: string, mods?: string[]) => { keys.push({ key, mods }) },
      sleep: async (ms: number) => { sleeps.push(ms) },
      random: (() => {
        let i = 0
        return () => [0, 0.5, 1, 0.25, 0.75][i++ % 5]
      })()
    },
    chars,
    keys,
    sleeps
  }
}

describe('typeStringWithDelay', () => {
  it('returns {completed:true, charactersTyped:0} for empty text without any calls', async () => {
    const { deps, chars, keys, sleeps } = makeDeps()
    const r = await typeStringWithDelay({ text: '', ...deps })
    expect(r).toEqual({ completed: true, charactersTyped: 0 })
    expect(chars).toEqual([])
    expect(keys).toEqual([])
    expect(sleeps).toEqual([])
  })

  it('splits by code point: emoji stays as one char', async () => {
    const { deps, chars } = makeDeps()
    await typeStringWithDelay({ text: '👍ok', ...deps })
    expect(chars).toEqual(['👍', 'o', 'k'])
  })

  it('handles CJK characters as single chars', async () => {
    const { deps, chars } = makeDeps()
    await typeStringWithDelay({ text: '你好', ...deps })
    expect(chars).toEqual(['你', '好'])
  })

  it('maps \\n to keyTap("enter", ["shift"]) not typeChar', async () => {
    const { deps, chars, keys } = makeDeps()
    await typeStringWithDelay({ text: 'a\nb', ...deps })
    expect(chars).toEqual(['a', 'b'])
    expect(keys).toEqual([{ key: 'enter', mods: ['shift'] }])
  })

  it('counts \\n in charactersTyped (matches competitor behavior)', async () => {
    const { deps } = makeDeps()
    const r = await typeStringWithDelay({ text: 'a\nb', ...deps })
    expect(r.charactersTyped).toBe(3) // a, \n, b
  })

  it('sleeps between every character including the last', async () => {
    const { deps, sleeps } = makeDeps()
    await typeStringWithDelay({ text: 'ab', minDelayMs: 35, maxDelayMs: 55, ...deps })
    expect(sleeps).toHaveLength(2)
    for (const s of sleeps) {
      expect(s).toBeGreaterThanOrEqual(35)
      expect(s).toBeLessThanOrEqual(55)
    }
  })

  it('stops early when isCancelled returns true after first char', async () => {
    let calls = 0
    const { deps, chars } = makeDeps()
    const r = await typeStringWithDelay({
      text: 'abc',
      isCancelled: () => calls++ >= 1,
      ...deps
    })
    expect(r.completed).toBe(false)
    expect(r.charactersTyped).toBe(1)
    expect(chars).toEqual(['a'])
  })

  it('reports charactersTyped on cancellation after newline (newline counts as a typed char)', async () => {
    let calls = 0
    const { deps } = makeDeps()
    const r = await typeStringWithDelay({
      text: '\n\nx',
      isCancelled: () => calls++ >= 2,
      ...deps
    })
    expect(r.completed).toBe(false)
    expect(r.charactersTyped).toBe(2)
  })

  it('handles cancellation during sleep', async () => {
    let cancelled = false
    const r = await typeStringWithDelay({
      text: 'abc',
      isCancelled: () => cancelled,
      typeChar: async () => {},
      keyTap: async () => {},
      sleep: async (ms) => {
        if (ms > 40) cancelled = true // second sleep cancels
      },
      random: () => 0.8 // produces large delay
    })
    expect(r.completed).toBe(false)
    expect(r.charactersTyped).toBeGreaterThanOrEqual(1)
  })

  it('uses default 35-55 range when minDelayMs/maxDelayMs omitted', async () => {
    const { deps, sleeps } = makeDeps()
    await typeStringWithDelay({ text: 'ab', ...deps })
    for (const s of sleeps) {
      expect(s).toBeGreaterThanOrEqual(35)
      expect(s).toBeLessThanOrEqual(55)
    }
  })

  it('swaps min/max when caller passes reversed values', async () => {
    const { deps, sleeps } = makeDeps()
    await typeStringWithDelay({ text: 'a', minDelayMs: 100, maxDelayMs: 30, ...deps })
    expect(sleeps[0]).toBeGreaterThanOrEqual(30)
    expect(sleeps[0]).toBeLessThanOrEqual(100)
  })

  it('supports async typeChar and keyTap', async () => {
    const chars: string[] = []
    const r = await typeStringWithDelay({
      text: 'ab',
      typeChar: async (ch) => { await Promise.resolve(); chars.push(ch) },
      keyTap: async () => {},
      sleep: async () => {},
      random: () => 0.5
    })
    expect(r.charactersTyped).toBe(2)
    expect(chars).toEqual(['a', 'b'])
  })

  it('waits for typeChar promise before next character', async () => {
    const order: string[] = []
    await typeStringWithDelay({
      text: 'ab',
      typeChar: async (ch) => {
        await new Promise((res) => setTimeout(res, 5))
        order.push(`char:${ch}`)
      },
      keyTap: () => {},
      sleep: async () => { order.push('sleep') },
      random: () => 0.5
    })
    expect(order).toEqual(['char:a', 'sleep', 'char:b', 'sleep'])
  })

  it('propagates typeChar errors instead of swallowing them', async () => {
    await expect(
      typeStringWithDelay({
        text: 'ab',
        typeChar: () => { throw new Error('typeChar failed') },
        keyTap: () => {},
        sleep: async () => {}
      })
    ).rejects.toThrow('typeChar failed')
  })

  it('propagates keyTap errors', async () => {
    await expect(
      typeStringWithDelay({
        text: 'a\nb',
        typeChar: () => {},
        keyTap: () => { throw new Error('keyTap failed') },
        sleep: async () => {}
      })
    ).rejects.toThrow('keyTap failed')
  })
})

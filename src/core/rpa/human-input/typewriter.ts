const DEFAULT_MIN_DELAY_MS = 35
const DEFAULT_MAX_DELAY_MS = 55

function getNonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback
}

export interface TypewriterOptions {
  text: string
  minDelayMs?: number
  maxDelayMs?: number
  isCancelled?: () => boolean
  random?: () => number
  typeChar: (ch: string) => void | Promise<void>
  keyTap: (key: string, modifiers?: string[]) => void | Promise<void>
  sleep: (ms: number) => Promise<void>
}

export interface TypewriterResult {
  completed: boolean
  /**
   * 已打字符数（含 \n）。
   * 与竞品 shiflow-agent/helper/typewriter.js 行为一致：\n 也算一个 typed character。
   */
  charactersTyped: number
}

export async function typeStringWithDelay(options: TypewriterOptions): Promise<TypewriterResult> {
  const characters = Array.from(String(options.text ?? ''))
  const rawMin = getNonNegativeNumber(options.minDelayMs, DEFAULT_MIN_DELAY_MS)
  const rawMax = getNonNegativeNumber(options.maxDelayMs, DEFAULT_MAX_DELAY_MS)
  const minDelayMs = Math.min(rawMin, rawMax)
  const maxDelayMs = Math.max(rawMin, rawMax)
  const isCancelled = options.isCancelled ?? (() => false)
  const random = options.random ?? Math.random

  let charactersTyped = 0
  for (const ch of characters) {
    if (isCancelled()) return { completed: false, charactersTyped }
    if (ch === '\n') {
      await options.keyTap('enter', ['shift'])
    } else {
      await options.typeChar(ch)
    }
    charactersTyped += 1
    const delayMs = Math.round(minDelayMs + random() * (maxDelayMs - minDelayMs))
    await options.sleep(delayMs)
  }
  return { completed: true, charactersTyped }
}

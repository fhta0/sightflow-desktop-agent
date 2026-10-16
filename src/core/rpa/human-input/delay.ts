/**
 * Box-Muller 正态分布 + 10% 长停顿 + 5% 加速段。
 * 对齐竞品 shiflow-agent/mouse-trajectory.js 的 generateIrregularDelay。
 *
 * 注：长停顿分支最小值 10ms（Math.max(10, ...)），加速段和默认分支最小值 5ms。
 * 长停顿和加速段是互斥分支（命中第一个 if 即 return）。
 */
export function generateIrregularDelay(
  baseDelay: number,
  random: () => number = Math.random
): number {
  let u1 = random()
  if (u1 === 0) u1 = 1e-9
  const u2 = random()
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  const normalDelay = baseDelay + z0 * baseDelay * 0.4

  if (random() < 0.1) {
    const pauseMultiplier = 2 + random() * 3
    return Math.max(10, Math.round(normalDelay * pauseMultiplier))
  }
  if (random() < 0.05) {
    return Math.max(5, Math.round(normalDelay * 0.3))
  }
  return Math.max(5, Math.round(normalDelay))
}

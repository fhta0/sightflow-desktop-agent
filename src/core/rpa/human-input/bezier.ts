import { generateIrregularDelay } from './delay'

export interface BezierPoint {
  x: number
  y: number
  delay: number
}

export interface BezierPath {
  points: BezierPoint[]
  finalX: number
  finalY: number
}

export interface BezierOptions {
  minSteps?: number
  maxSteps?: number
  baseDelay?: number
  random?: () => number
}

/**
 * 二次 ease-in-out 缓动（与竞品 shiflow-agent/mouse-trajectory.js 一致）。
 * 注意：这是缓动函数，不是贝塞尔曲线的次数。贝塞尔曲线本身是三次（cubic）。
 */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

export function generateBezierPath(
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
  opts: BezierOptions = {}
): BezierPath {
  const {
    minSteps = 5,
    maxSteps = 15,
    baseDelay = 10,
    random = Math.random
  } = opts

  const dx = targetX - startX
  const dy = targetY - startY
  const distance = Math.sqrt(dx * dx + dy * dy)

  if (distance < 1) {
    return { points: [], finalX: targetX, finalY: targetY }
  }

  const steps = Math.min(
    maxSteps,
    Math.max(minSteps, Math.floor(distance / 40) + Math.floor(random() * 3))
  )

  const ctrl1X = startX + dx * random() * 0.5 + (random() - 0.5) * distance * 0.2
  const ctrl1Y = startY + dy * random() * 0.5 + (random() - 0.5) * distance * 0.2
  const ctrl2X = startX + dx * (0.5 + random() * 0.5) + (random() - 0.5) * distance * 0.2
  const ctrl2Y = startY + dy * (0.5 + random() * 0.5) + (random() - 0.5) * distance * 0.2

  const points: BezierPoint[] = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const easedT = easeInOut(t)
    const invT = 1 - easedT
    const x =
      Math.pow(invT, 3) * startX +
      3 * Math.pow(invT, 2) * easedT * ctrl1X +
      3 * invT * Math.pow(easedT, 2) * ctrl2X +
      Math.pow(easedT, 3) * targetX
    const y =
      Math.pow(invT, 3) * startY +
      3 * Math.pow(invT, 2) * easedT * ctrl1Y +
      3 * invT * Math.pow(easedT, 2) * ctrl2Y +
      Math.pow(easedT, 3) * targetY

    const jitterX = i === steps ? 0 : (random() - 0.5) * 1.5
    const jitterY = i === steps ? 0 : (random() - 0.5) * 1.5
    const delay = generateIrregularDelay(baseDelay, random)

    points.push({
      x: Math.round(x + jitterX),
      y: Math.round(y + jitterY),
      delay: Math.round(delay)
    })
  }
  // 末点修正到精确坐标（覆盖 jitter），保证最后一步落点 = target
  const last = points[points.length - 1]
  last.x = targetX
  last.y = targetY
  return { points, finalX: targetX, finalY: targetY }
}

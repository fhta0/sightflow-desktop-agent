import { clipboard } from 'electron'
import { AppType } from './types'
import { getWindowInfo } from './window-utils'
import { getInputAreaFromCache } from './vision-utils'
const IS_WINDOWS = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

import { delay, randomDelayIn, getRobot } from './util'

// 原版 whatsapp-agent-demo 的贝塞尔曲线仿人滑动
async function humanLikeMove(
  targetX: number,
  targetY: number,
  options: {
    minSteps?: number
    maxSteps?: number
    baseDelay?: number
  } = {}
): Promise<void> {
  const robot = getRobot()
  if (!robot) return

  const { minSteps = 5, maxSteps = 15, baseDelay = 2 } = options

  const startPos = robot.getMousePos()
  const dx = targetX - startPos.x
  const dy = targetY - startPos.y
  const distance = Math.sqrt(dx * dx + dy * dy)

  if (distance < 1) {
    robot.moveMouse(Math.round(targetX), Math.round(targetY))
    return
  }

  // 根据距离决定步数
  const steps = Math.min(
    maxSteps,
    Math.max(minSteps, Math.floor(distance / 40) + Math.floor(Math.random() * 3))
  )

  // 生成贝塞尔曲线控制点 (Cubic Bezier)
  const ctrl1X = startPos.x + dx * Math.random() * 0.5 + (Math.random() - 0.5) * distance * 0.2
  const ctrl1Y = startPos.y + dy * Math.random() * 0.5 + (Math.random() - 0.5) * distance * 0.2
  const ctrl2X = startPos.x + dx * (0.5 + Math.random() * 0.5) + (Math.random() - 0.5) * distance * 0.2
  const ctrl2Y = startPos.y + dy * (0.5 + Math.random() * 0.5) + (Math.random() - 0.5) * distance * 0.2

  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    
    // 匀速转非线性 (Ease Out)
    const easeT = t * (2 - t)
    
    const mt = 1 - easeT
    const mt2 = mt * mt
    const mt3 = mt2 * mt
    const easeT2 = easeT * easeT
    const easeT3 = easeT2 * easeT

    // 贝塞尔曲线公式计算
    const x = mt3 * startPos.x + 3 * mt2 * easeT * ctrl1X + 3 * mt * easeT2 * ctrl2X + easeT3 * targetX
    const y = mt3 * startPos.y + 3 * mt2 * easeT * ctrl1Y + 3 * mt * easeT2 * ctrl2Y + easeT3 * targetY

    // 加入随机细微抖动 (±1像素)
    const jitterX = i === steps ? 0 : (Math.random() - 0.5) * 2
    const jitterY = i === steps ? 0 : (Math.random() - 0.5) * 2

    robot.moveMouse(Math.round(x + jitterX), Math.round(y + jitterY))

    // 变频延迟，模拟人类微停顿
    let stepDelay = baseDelay + Math.random() * 2
    if (i > steps * 0.8) stepDelay += 2
    
    await delay(stepDelay)
  }
}

/**
 * 点击风格：影响按压时长和整体节奏
 * - fast: 快速点击，适合熟练用户的习惯操作
 * - normal: 正常点击，最常见的节奏
 * - careful: 谨慎点击，对重要操作的小心确认
 */
export type ClickStyle = 'fast' | 'normal' | 'careful'

/**
 * 根据点击风格获取按压时长范围（毫秒）
 */
function getPressDurationRange(style: ClickStyle): { min: number; max: number } {
  switch (style) {
    case 'fast':
      return { min: 40, max: 80 }      // 快速熟练点击
    case 'normal':
      return { min: 80, max: 160 }     // 正常点击
    case 'careful':
      return { min: 150, max: 280 }    // 谨慎确认点击
  }
}

/**
 * 随机选择点击风格（权重：fast 20%, normal 60%, careful 20%）
 */
function randomClickStyle(): ClickStyle {
  const r = Math.random()
  if (r < 0.2) return 'fast'
  if (r < 0.8) return 'normal'
  return 'careful'
}

/**
 * 仿人化的鼠标点击函数
 * 将点击分解为按下和抬起，并加入随机物理按压延迟
 *
 * 人类点击特征：
 * 1. 按压时长不固定（快速40-80ms，正常80-160ms，谨慎150-280ms）
 * 2. 按下过程有微小抖动（手指不是完全稳定）
 * 3. 点击后自然停顿（模拟反应时间）
 *
 * @param button 鼠标按键，默认 'left'
 * @param style 点击风格，默认随机
 */
export async function humanLikeClick(
  button: 'left' | 'right' = 'left',
  style?: ClickStyle
): Promise<void> {
  const robot = getRobot()
  if (!robot) return

  const actualStyle = style ?? randomClickStyle()
  const { min, max } = getPressDurationRange(actualStyle)

  try {
    // 模拟按下
    robot.mouseToggle('down', button)

    // 模拟按压过程中的微小抖动（人类手指不是完全稳定）
    // 只在 normal 和 careful 模式下添加抖动
    if (actualStyle !== 'fast') {
      const pos = robot.getMousePos()
      const jitterCount = Math.floor(Math.random() * 2) + 1 // 1-2次抖动

      for (let i = 0; i < jitterCount; i++) {
        const jitterX = (Math.random() - 0.5) * 2  // ±1像素
        const jitterY = (Math.random() - 0.5) * 2
        robot.moveMouse(Math.round(pos.x + jitterX), Math.round(pos.y + jitterY))
        await delay(15 + Math.random() * 20)
      }
    }

    // 模拟物理按压耗时
    const pressDuration = min + Math.random() * (max - min)
    await delay(Math.round(pressDuration))

    // 模拟抬起
    robot.mouseToggle('up', button)

    // 点击后的随机微小停顿，模拟人类反应（反应时间通常100-250ms）
    const afterClickDelay = 80 + Math.random() * 170
    await delay(Math.round(afterClickDelay))
  } catch (error) {
    console.error('【拟人化点击】执行失败:', error)
    // 降级处理：如果异常，确保至少尝试点击
    robot.mouseClick(button)
  }
}

const getWeChatInputPosition = (bounds: any, scaleFactor: number) => {
  if (IS_WINDOWS) {
    const baseInputX = Math.round((bounds.x + bounds.width - 150) * scaleFactor)
    const baseInputY = Math.round((bounds.y + bounds.height - 40) * scaleFactor)
    return { inputX: baseInputX + (Math.random() - 0.5) * 20, inputY: baseInputY - Math.random() * 5 }
  }
  const baseInputX = bounds.x + bounds.width - 250
  const baseInputY = bounds.y + bounds.height - 20
  return { inputX: baseInputX + (Math.random() - 0.5) * 20, inputY: baseInputY - Math.random() * 5 }
}

/**
 * 业务原子 2 — 核心实现：按给定坐标发送消息（不依赖 VLM 缓存）。
 * `sendReplyAction`（VLM 路线）与 `BoxSelectDevice.sendMessage`（框选路线）共用此函数。
 *
 * 人类行为特征：
 * 1. 移动到输入框有轨迹，不是瞬间到位
 * 2. 点击聚焦后有短暂停顿（等待输入框激活）
 * 3. 粘贴前有"准备动作"停顿
 * 4. 发送前有"检查内容"停顿（人类习惯）
 * 5. 发送后自然移动鼠标离开
 *
 * 1. humanLikeMove → 输入框焦点坐标 (x, y)
 * 2. 仿人点击聚焦
 * 3. 剪贴板 + Cmd/Ctrl+V 粘贴
 * 4. Enter 发送
 */
export async function sendReplyByCoordsAction(
  x: number,
  y: number,
  text: string
): Promise<boolean> {
  const robot = getRobot()
  if (!robot) {
    console.error('[sendReplyByCoordsAction] RobotJS 缺失')
    return false
  }

  try {
    // 阶段 1: 移动到目标附近（模拟人类先大致定位）
    const approachX = x + (Math.random() - 0.5) * 30  // 扩大范围
    const approachY = y + (Math.random() - 0.5) * 30
    await humanLikeMove(approachX, approachY)
    await randomDelayIn(150, 280)

    // 阶段 2: 微调到精确位置
    const jitterX = (Math.random() - 0.5) * 10
    const jitterY = (Math.random() - 0.5) * 10
    robot.moveMouse(Math.round(x + jitterX), Math.round(y + jitterY))
    await randomDelayIn(100, 180)

    // 阶段 3: 点击前的犹豫停顿
    await hesitationPause(false)

    // 阶段 4: 仿人点击聚焦（使用 careful 风格，聚焦是重要操作）
    await humanLikeClick('left', 'careful')
    await randomDelayIn(300, 500)  // 等待输入框激活

    // 阶段 5: 写入剪贴板前的"准备动作"停顿
    await randomDelayIn(80, 150)
    clipboard.writeText(text)
    await randomDelayIn(100, 200)  // 剪贴板写入后的停顿

    // 阶段 6: 粘贴操作
    if (IS_MAC) {
      robot.keyTap('v', ['command'])
    } else {
      robot.keyTap('v', ['control'])
    }

    // 粘贴后的停顿（等待内容显示，人类通常会看一下）
    await randomDelayIn(500, 800)

    // 阶段 7: 发送前的"检查内容"停顿（人类习惯确认发送内容）
    await randomDelayIn(300, 600)

    // 发送
    robot.keyTap('enter')

    // 阶段 8: Windows 和 Mac 的后续清理
    if (IS_WINDOWS) {
      await randomDelayIn(80, 150)
      robot.keyTap('enter', ['control'])
      await randomDelayIn(80, 120)
      robot.keyTap('backspace')
    } else {
      await randomDelayIn(60, 100)
      robot.keyTap('enter', ['command'])
      await randomDelayIn(50, 80)
      robot.keyToggle('command', 'up')
      await randomDelayIn(50, 80)
      robot.keyTap('backspace')
    }

    // 阶段 9: 发送后的自然停顿和鼠标移动
    await randomDelayIn(200, 400)
    // 鼠标轻微移开（人类发送后通常会移开视线/鼠标）
    const postSendX = x + (Math.random() - 0.5) * 30
    const postSendY = y + (Math.random() - 0.5) * 30
    robot.moveMouse(Math.round(postSendX), Math.round(postSendY))

    return true
  } catch (err: any) {
    console.error('[sendReplyByCoordsAction] Failed:', err)
    return false
  }
}

/**
 * 业务原子 2：极简防检测回复模式（VLM 路线适配器）。
 * 从 layout cache 中找输入框坐标，缺失时回退到经验公式，最终调用 `sendReplyByCoordsAction`。
 */
export async function sendReplyAction(appType: AppType, text: string): Promise<boolean> {
  const windowInfo = await getWindowInfo(appType, false)
  if (!windowInfo || !windowInfo.bounds) {
    console.error('[sendReplyAction] 无法获取窗口信息')
    return false
  }

  let inputX: number | undefined
  let inputY: number | undefined

  // 优先从缓存获取输入框坐标（chatMainArea 反推）
  const inputArea = getInputAreaFromCache(appType)
  if (inputArea) {
    inputX = inputArea.coordinates[0] + (Math.random() - 0.5) * 10
    inputY = inputArea.coordinates[1] + (Math.random() - 0.5) * 4
    console.log(`[sendReplyAction] 使用缓存输入框坐标: (${inputX}, ${inputY})`)
  }

  // Fallback 处理
  if (inputX === undefined || inputY === undefined) {
    console.log('[sendReplyAction] 使用 Fallback 逻辑生成输入框坐标')
    const pos = getWeChatInputPosition(windowInfo.bounds, windowInfo.scaleFactor || 1)
    inputX = pos.inputX
    inputY = pos.inputY
  }

  return sendReplyByCoordsAction(inputX, inputY, text)
}

export type ClickPolicy = 'single' | 'double'

/**
 * 默认点击策略：仅微信桌面端需要双击红点切换会话；
 * 企业微信、钉钉、飞书、Slack、Telegram 以及任何 generic 应用都用单击。
 */
export function defaultClickPolicy(appType: AppType): ClickPolicy {
  return appType === 'wechat' ? 'double' : 'single'
}

/**
 * 点击前的"犹豫"停顿 - 模拟人类心理确认过程
 * @param isImportant 是否是重要操作（如双击切换会话），犹豫时间更长
 */
async function hesitationPause(isImportant: boolean = false): Promise<void> {
  if (isImportant) {
    // 重要操作犹豫时间更长：300-600ms
    await randomDelayIn(300, 600)
  } else {
    // 普通操作短暂停顿：100-250ms（约20%概率会有更长停顿）
    if (Math.random() < 0.2) {
      await randomDelayIn(180, 350)
    } else {
      await randomDelayIn(80, 180)
    }
  }
}

/**
 * 业务原子 3：点击红点区域激活未读消息（纯视觉路线）
 *
 * 参考 whatsapp-agent-demo 的 activeUnreadByClick：
 * - 微信场景：双击红点区域（单击只是展开，双击才会切换）
 * - 企业微信、通用 IM 场景：单击即可
 *
 * 人类行为特征：
 * 1. 先移动到目标附近，再精细调整（不是直接到位）
 * 2. 点击前有短暂犹豫（心理确认）
 * 3. 双击间隔不固定（人类双击约100-300ms）
 * 4. 点击后鼠标轻微移开（不会完全静止）
 *
 * 旧签名 (coords, appType) 仍然支持；想显式指定策略时传第三个参数。
 */
export async function activeUnreadByClickAction(
  coordinates: [number, number],
  appType: AppType,
  clickPolicy?: ClickPolicy
): Promise<void> {
  const robot = getRobot()
  if (!robot) return

  const [centerX, centerY] = coordinates
  const policy: ClickPolicy = clickPolicy ?? defaultClickPolicy(appType)
  const isSingleClick = policy === 'single'

  console.log(`[activeUnreadByClick] ${isSingleClick ? '单击' : '双击'}红点`, {
    centerX,
    centerY,
    appType,
    policy
  })

  // 阶段 1: 移动到目标附近（非精确位置，模拟人类先大致定位）
  const approachX = centerX + (Math.random() - 0.5) * 30  // 扩大范围
  const approachY = centerY + (Math.random() - 0.5) * 30
  await humanLikeMove(approachX, approachY)
  await randomDelayIn(120, 220)  // 增加停顿

  // 阶段 2: 微调到精确位置（小幅度的精细调整）
  const jitterX = (Math.random() - 0.5) * 8
  const jitterY = (Math.random() - 0.5) * 8
  robot.moveMouse(Math.round(centerX + jitterX), Math.round(centerY + jitterY))
  await randomDelayIn(80, 160)

  // 阶段 3: 点击前的犹豫停顿（双击操作犹豫时间更长）
  await hesitationPause(!isSingleClick)

  // 根据 policy 执行单击或双击
  await humanLikeClick('left')
  if (!isSingleClick) {
    // 双击：第二次点击间隔随机化（人类双击间隔100-300ms，变化较大）
    await randomDelayIn(100, 280)
    await humanLikeClick('left')
  }

  // 阶段 4: 点击后的小幅移动（模拟点击后自然的鼠标微调）
  await randomDelayIn(150, 300)
  const postClickX = centerX + (Math.random() - 0.5) * 20
  const postClickY = centerY + (Math.random() - 0.5) * 20
  robot.moveMouse(Math.round(postClickX), Math.round(postClickY))
}

/**
 * 业务原子 4：点击联系人列表第一个未读联系人
 *
 * 参考 whatsapp-agent-demo 的 clickUnreadContact
 *
 * 人类行为特征：
 * 1. 移动轨迹有曲线，不是直线
 * 2. 到达后有短暂停顿（确认位置）
 * 3. 点击后鼠标自然移开
 */
export async function clickUnreadContactAction(
  coordinates: [number, number]
): Promise<void> {
  const robot = getRobot()
  if (!robot) return

  const [firstContactX, firstContactY] = coordinates
  console.log('[clickUnreadContact] 点击联系人', {
    firstContactX,
    firstContactY
  })

  // 阶段 1: 移动到目标附近（非精确位置，模拟人类先大致定位）
  const approachX = firstContactX + (Math.random() - 0.5) * 35  // 扩大范围
  const approachY = firstContactY + (Math.random() - 0.5) * 35
  await humanLikeMove(approachX, approachY)
  await randomDelayIn(150, 280)  // 增加停顿

  // 阶段 2: 微调到精确位置（小幅度的精细调整）
  const jitterX = (Math.random() - 0.5) * 10
  const jitterY = (Math.random() - 0.5) * 10
  robot.moveMouse(Math.round(firstContactX + jitterX), Math.round(firstContactY + jitterY))
  await randomDelayIn(100, 180)

  // 阶段 3: 点击前的犹豫停顿
  await hesitationPause(false)

  // 使用仿人点击
  await humanLikeClick('left')

  // 阶段 4: 点击后的小幅移动（模拟点击后自然的鼠标微调）
  await randomDelayIn(200, 350)
  const postClickX = firstContactX + (Math.random() - 0.5) * 25
  const postClickY = firstContactY + (Math.random() - 0.5) * 25
  robot.moveMouse(Math.round(postClickX), Math.round(postClickY))

  console.log('[clickUnreadContact] 点击完成')
}

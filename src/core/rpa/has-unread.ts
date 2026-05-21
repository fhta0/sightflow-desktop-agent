// src/core/rpa/has-unread.ts
// 未读消息检测 — 红点"两步走"
//
// Step 1: hasUnreadMessage — 粗检测
//   VLM 定位 chatEntranceArea → 局部 crop → 红点像素扫描 → percentage > 1%?
//
// Step 2: isChatContactUnread — 细检测
//   VLM 定位 firstContact → 局部 crop → 红点像素扫描 → percentage > 4%?
//   含边缘分析 + 自适应 crop 扩展重试

import { AIClient } from '../ai-client'
import { AppType } from './types'
import { captureWechatWindow, calculateRedDotPercentage } from './screenshot-utils'
import { getWindowInfo } from './window-utils'
import { getUnreadArea, bboxToCropBounds, BBox } from './vision-utils'

// ── Step 1: 粗检测 ──

/**
 * 检测是否有未读消息
 *
 * 流程:
 * 1. 获取 chatEntranceArea（VLM 定位/缓存）
 * 2. 局部 crop 截图
 * 3. 红点像素扫描
 * 4. percentage > 1% → 有未读
 */
export async function hasUnreadMessage(
  aiClient: AIClient,
  appType: AppType
): Promise<{
  success: boolean
  hasUnread?: boolean
  percentage?: number
  chatEntranceArea?: { bbox: BBox; coordinates: [number, number] }
  firstContact?: { bbox: BBox; coordinates: [number, number] }
  error?: string
}> {
  const THRESHOLD = 1 // 1% 红点占比阈值

  try {
    console.log('[HasUnread] Step 1: 粗检测 — 检测聊天入口红点')

    // 1. 获取未读区域
    const unreadArea = await getUnreadArea(aiClient, appType)
    if (!unreadArea.chatEntranceArea?.bbox) {
      return { success: false, error: '无法获取聊天入口区域' }
    }

    // 2. 获取窗口信息
    const windowInfo = await getWindowInfo(appType, false)
    if (!windowInfo?.bounds) {
      return { success: false, error: '获取窗口信息失败' }
    }

    // 3. bbox → crop bounds
    const cropBounds = bboxToCropBounds(
      unreadArea.chatEntranceArea.bbox,
      windowInfo.bounds
    )

    // 4. 局部截图
    const screenshotResult = await captureWechatWindow(appType, cropBounds)
    if (!screenshotResult.success || !screenshotResult.screenshotBase64) {
      return { success: false, error: screenshotResult.error || '局部截图失败' }
    }

    // 5. 红点像素扫描（只扫第一象限=右上角）
    const percentage = await calculateRedDotPercentage(
      screenshotResult.screenshotBase64,
      true // onlyFirstQuadrant
    )

    if (percentage === null) {
      return { success: false, error: '红点计算失败' }
    }

    const hasUnread = percentage > THRESHOLD

    console.log('[HasUnread] Step 1 结果:', {
      percentage: `${percentage.toFixed(2)}%`,
      threshold: `${THRESHOLD}%`,
      hasUnread
    })

    return {
      success: true,
      hasUnread,
      percentage,
      chatEntranceArea: unreadArea.chatEntranceArea,
      firstContact: unreadArea.firstContact || undefined
    }
  } catch (error: any) {
    console.error('[HasUnread] Step 1 失败:', error)
    return { success: false, error: error?.message || String(error) }
  }
}

// ── Step 2: 细检测 ──

/**
 * 检测当前联系人是否有未读消息（细检测）
 *
 * 流程:
 * 1. 获取 firstContact（VLM 定位/缓存）
 * 2. 局部 crop 截图（调整为正方形）
 * 3. 红点像素扫描
 * 4. 边缘分析：如果红色像素触碰 crop 边缘，扩展重试
 * 5. percentage > 4% → 有未读
 */
export async function isChatContactUnread(
  aiClient: AIClient,
  appType: AppType
): Promise<{
  success: boolean
  isUnread?: boolean
  percentage?: number
  firstContact?: { bbox: BBox; coordinates: [number, number] }
  error?: string
}> {
  const THRESHOLD = 4         // 4% 红点占比阈值
  const NO_RED_THRESHOLD = 0.5 // 低于此值认为没有红点
  const MAX_RETRIES = 2
  const EXPAND_STEP = 0.1     // 每次扩展 10%

  try {
    console.log('[HasUnread] Step 2: 细检测 — 检测联系人头像红点')

    // 1. 获取未读区域
    const unreadArea = await getUnreadArea(aiClient, appType)
    if (!unreadArea.firstContact?.bbox) {
      return { success: false, error: '无法获取第一个联系人区域' }
    }

    // 2. 获取窗口信息
    const windowInfo = await getWindowInfo(appType, false)
    if (!windowInfo?.bounds) {
      return { success: false, error: '获取窗口信息失败' }
    }

    const { firstContact } = unreadArea

    // 3. bbox → crop bounds（调整为正方形）
    const cropBounds = bboxToCropBounds(firstContact.bbox, windowInfo.bounds)
    cropBounds.width = cropBounds.height // 1:1 正方形

    let currentCrop = { ...cropBounds }
    let retryCount = 0
    let lastPercentage = 0

    // 4. 边缘检测 + 扩展重试循环
    while (retryCount <= MAX_RETRIES) {
      console.log(`[HasUnread] Step 2: 第 ${retryCount + 1} 次尝试`, {
        crop: currentCrop
      })

      // 局部截图
      const screenshotResult = await captureWechatWindow(appType, currentCrop)
      if (!screenshotResult.success || !screenshotResult.screenshotBase64) {
        return { success: false, error: '局部截图失败' }
      }

      // 红点像素扫描
      const percentage = await calculateRedDotPercentage(
        screenshotResult.screenshotBase64,
        true
      )

      if (percentage === null) {
        return { success: false, error: '红点计算失败' }
      }

      lastPercentage = percentage

      // 4a. 占比太低，没有红点
      if (percentage < NO_RED_THRESHOLD) {
        console.log('[HasUnread] Step 2: 红点占比过低，判定无红点', {
          percentage: `${percentage.toFixed(2)}%`
        })
        return {
          success: true,
          isUnread: false,
          percentage,
          firstContact
        }
      }

      // 4b. 超过阈值，确认有红点
      if (percentage > THRESHOLD) {
        console.log('[HasUnread] Step 2: 红点占比超过阈值，确认有红点', {
          percentage: `${percentage.toFixed(2)}%`
        })
        return {
          success: true,
          isUnread: true,
          percentage,
          firstContact
        }
      }

      // 4c. 尴尬区间 (0.5% ~ 4%)，做边缘分析
      console.log('[HasUnread] Step 2: 尴尬区间，进行边缘分析', {
        percentage: `${percentage.toFixed(2)}%`
      })

      const edgeAnalysis = await analyzeRedPixelEdge(
        screenshotResult.screenshotBase64
      )

      if (!edgeAnalysis || !edgeAnalysis.hasEdgeTouch) {
        // 无边缘触碰，用当前结果
        break
      }

      // 有边缘触碰 && 还有重试次数 → 扩展 crop
      if (retryCount < MAX_RETRIES) {
        const expandX = currentCrop.width * EXPAND_STEP
        const expandY = currentCrop.height * EXPAND_STEP

        if (edgeAnalysis.touchTop) {
          currentCrop.y -= expandY
          currentCrop.height += expandY
        }
        if (edgeAnalysis.touchRight) {
          currentCrop.width += expandX
        }
        if (edgeAnalysis.touchBottom) {
          currentCrop.height += expandY
        }
        if (edgeAnalysis.touchLeft) {
          currentCrop.x -= expandX
          currentCrop.width += expandX
        }

        console.log('[HasUnread] Step 2: 扩展 crop 区域', {
          retryCount: retryCount + 1,
          edge: edgeAnalysis,
          newCrop: currentCrop
        })
      }

      retryCount++
    }

    // 循环结束，用最终百分比判断
    const isUnread = lastPercentage > THRESHOLD

    console.log('[HasUnread] Step 2 最终结果:', {
      percentage: `${lastPercentage.toFixed(2)}%`,
      threshold: `${THRESHOLD}%`,
      isUnread,
      retryCount
    })

    return {
      success: true,
      isUnread,
      percentage: lastPercentage,
      firstContact
    }
  } catch (error: any) {
    console.error('[HasUnread] Step 2 失败:', error)
    return { success: false, error: error?.message || String(error) }
  }
}

// ── 边缘分析 ──

interface EdgeAnalysis {
  touchTop: boolean
  touchRight: boolean
  touchBottom: boolean
  touchLeft: boolean
  hasEdgeTouch: boolean
}

/**
 * 分析红色像素的边缘分布
 * 如果红色像素触碰了 crop 的边缘，说明红点可能被截断了
 */
async function analyzeRedPixelEdge(
  base64Image: string
): Promise<EdgeAnalysis | null> {
  try {
    const { Jimp, intToRGBA } = await import('jimp')
    const buffer = Buffer.from(
      base64Image.replace(/^data:image\/\w+;base64,/, ''),
      'base64'
    )
    const image = await Jimp.read(buffer)
    const { width, height } = image.bitmap

    if (width === 0 || height === 0) return null

    const EDGE_MARGIN = 2 // 边缘判定距离（像素）
    let touchTop = false
    let touchRight = false
    let touchBottom = false
    let touchLeft = false

    // 只扫第一象限（右上角）的红色像素
    const centerX = width / 2
    const centerY = height / 2

    for (let x = Math.floor(centerX); x < width; x++) {
      for (let y = 0; y < Math.floor(centerY); y++) {
        const rgba = intToRGBA(image.getPixelColor(x, y))
        const { r, g, b, a } = rgba

        if (a > 128 && r > 150 && r > g * 1.5 && r > b * 1.5) {
          // 是红色像素，检查是否在边缘
          if (y < EDGE_MARGIN) touchTop = true
          if (x >= width - EDGE_MARGIN) touchRight = true
          if (y >= Math.floor(centerY) - EDGE_MARGIN) touchBottom = true
          if (x < Math.floor(centerX) + EDGE_MARGIN) touchLeft = true
        }
      }
    }

    return {
      touchTop,
      touchRight,
      touchBottom,
      touchLeft,
      hasEdgeTouch: touchTop || touchRight || touchBottom || touchLeft
    }
  } catch (error) {
    console.error('[HasUnread] 边缘分析失败:', error)
    return null
  }
}

// ── 联系人列表红点扫描 ──

import { Jimp, intToRGBA } from 'jimp'

interface RedDotPosition {
  x: number
  y: number
  confidence: number
}

/**
 * 在联系人列表区域扫描所有红点
 * 返回当前可见联系人列表中所有检测到的红点位置
 *
 * @param appType 应用类型
 * @param contactListArea 联系人列表区域（相对于窗口的逻辑像素坐标，不传则自动计算）
 * @returns 红点位置数组（屏幕绝对坐标），如果没找到返回空数组
 */
export async function scanContactListForRedDots(
  appType: AppType,
  contactListArea?: { x: number; y: number; width: number; height: number }
): Promise<RedDotPosition[]> {
  try {
    console.log('[HasUnread] 扫描联系人列表区域寻找所有红点...')

    // 获取窗口信息
    const windowInfo = await getWindowInfo(appType, false)
    if (!windowInfo?.bounds) {
      console.error('[HasUnread] 无法获取窗口信息')
      return []
    }

    const { bounds, scaleFactor } = windowInfo
    const isWindows = process.platform === 'win32'

    // 计算扫描区域（逻辑像素，相对于窗口）
    // 微信联系人列表在中间列，大致从 8% 到 36% 宽度，从 12% 到 90% 高度
    const scanAreaLogical = contactListArea || {
      x: bounds.width * 0.08,   // 跳过左侧导航栏（约 8%）
      y: bounds.height * 0.12,  // 跳过搜索框（约 12%）
      width: bounds.width * 0.28, // 中间联系人列宽度（约 28%）
      height: bounds.height * 0.78 // 联系人列表高度（约 78%）
    }

    // 转换为屏幕绝对坐标（物理像素）用于截图
    // Windows: bounds 是物理像素，需要转换
    // macOS: bounds 是逻辑像素
    let screenCrop
    if (isWindows) {
      // Windows: 截图需要物理像素坐标
      screenCrop = {
        x: Math.round((bounds.x + scanAreaLogical.x)),
        y: Math.round((bounds.y + scanAreaLogical.y)),
        width: Math.round(scanAreaLogical.width),
        height: Math.round(scanAreaLogical.height)
      }
    } else {
      // macOS: 截图使用逻辑像素
      screenCrop = {
        x: Math.round(bounds.x + scanAreaLogical.x),
        y: Math.round(bounds.y + scanAreaLogical.y),
        width: Math.round(scanAreaLogical.width),
        height: Math.round(scanAreaLogical.height)
      }
    }

    console.log('[HasUnread] 扫描区域计算:', {
      platform: isWindows ? 'Windows' : 'macOS',
      windowSize: { width: bounds.width, height: bounds.height },
      logicalArea: scanAreaLogical,
      screenCrop: screenCrop,
      scaleFactor
    })

    // 截图整个窗口（不裁剪），然后自己裁剪
    const screenshotResult = await captureWechatWindow(appType)
    if (!screenshotResult.success || !screenshotResult.screenshotBase64) {
      console.error('[HasUnread] 截图失败')
      return []
    }

    // 解析图像
    const buffer = Buffer.from(
      screenshotResult.screenshotBase64.replace(/^data:image\/\w+;base64,/, ''),
      'base64'
    )
    const fullImage = await Jimp.read(buffer)

    // 裁剪出联系人列表区域（相对于窗口的逻辑像素）
    const cropX = Math.round(scanAreaLogical.x)
    const cropY = Math.round(scanAreaLogical.y)
    const cropWidth = Math.round(scanAreaLogical.width)
    const cropHeight = Math.round(scanAreaLogical.height)

    console.log('[HasUnread] 裁剪联系人列表区域:', {
      fullSize: { width: fullImage.bitmap.width, height: fullImage.bitmap.height },
      crop: { x: cropX, y: cropY, width: cropWidth, height: cropHeight }
    })

    // 检查裁剪区域是否有效
    if (cropX + cropWidth > fullImage.bitmap.width || cropY + cropHeight > fullImage.bitmap.height) {
      console.warn('[HasUnread] 裁剪区域超出图像范围，使用全图')
      // 调整裁剪区域
      const adjustedWidth = Math.min(cropWidth, fullImage.bitmap.width - cropX)
      const adjustedHeight = Math.min(cropHeight, fullImage.bitmap.height - cropY)
      if (adjustedWidth <= 0 || adjustedHeight <= 0) {
        console.error('[HasUnread] 裁剪区域无效')
        return []
      }
    }

    // 裁剪联系人列表区域
    const image = fullImage.crop({
      x: cropX,
      y: cropY,
      w: cropWidth,
      h: cropHeight
    })
    const { width, height } = image.bitmap

    console.log(`[HasUnread] 扫描区域尺寸: ${width}x${height}`)

    // 扫描红点：联系人头像在每行左侧，红点在头像右上角
    // 联系人列表可滚动，头像分布在整个高度，需要扫全区域
    // 头像只在左侧约 1/3 宽度范围内，限制 x 范围减少误报
    const avatarZoneWidth = Math.floor(width * 0.45)

    // 存储检测到的红点位置
    const redDots: { x: number; y: number; redIntensity: number }[] = []

    // 扫描步长（每5个像素扫描一次，提高效率）
    const step = 5

    for (let x = 0; x < avatarZoneWidth; x += step) {
      for (let y = 0; y < height; y += step) {
        const rgba = intToRGBA(image.getPixelColor(x, y))
        const { r, g, b, a } = rgba

        // 红点检测条件：红色明显强于绿色和蓝色，且透明度足够
        if (a > 128 && r > 180 && r > g * 1.6 && r > b * 1.6) {
          redDots.push({ x, y, redIntensity: r })
        }
      }
    }

    if (redDots.length === 0) {
      console.log('[HasUnread] 未在联系人列表中找到红点')
      return []
    }

    // 对检测到的红点进行聚类（相邻的点可能是同一个红点）
    const clusters: { points: typeof redDots; avgX: number; avgY: number }[] = []
    const clusterRadius = 30 // 聚类半径

    for (const dot of redDots) {
      let addedToCluster = false

      for (const cluster of clusters) {
        const distance = Math.sqrt(
          Math.pow(dot.x - cluster.avgX, 2) + Math.pow(dot.y - cluster.avgY, 2)
        )
        if (distance < clusterRadius) {
          cluster.points.push(dot)
          // 重新计算平均值
          cluster.avgX = cluster.points.reduce((sum, p) => sum + p.x, 0) / cluster.points.length
          cluster.avgY = cluster.points.reduce((sum, p) => sum + p.y, 0) / cluster.points.length
          addedToCluster = true
          break
        }
      }

      if (!addedToCluster) {
        clusters.push({
          points: [dot],
          avgX: dot.x,
          avgY: dot.y
        })
      }
    }

    // 按y坐标排序（从上到下）
    clusters.sort((a, b) => a.avgY - b.avgY)

    // 过滤掉太小的聚类（< 3 个红色像素 = 噪点）
    // 真正的红点角标至少包含几十个像素，即使 step=5 采样也会命中多个点
    const MIN_PIXELS = 3
    const validClusters = clusters.filter(c => c.points.length >= MIN_PIXELS)

    if (validClusters.length === 0) {
      console.log('[HasUnread] 红点聚类均太小，视为无红点')
      return []
    }

    // 转换为屏幕坐标（物理像素，用于点击）
    const results: RedDotPosition[] = validClusters.map(cluster => {
      // 计算相对于窗口的逻辑像素位置
      const logicalX = scanAreaLogical.x + cluster.avgX
      const logicalY = scanAreaLogical.y + cluster.avgY

      // 转换为屏幕绝对坐标
      if (isWindows) {
        // Windows: 使用物理像素
        return {
          x: Math.round((bounds.x + logicalX)),
          y: Math.round((bounds.y + logicalY)),
          confidence: cluster.points.length / redDots.length
        }
      } else {
        // macOS: 使用逻辑像素
        return {
          x: Math.round(bounds.x + logicalX),
          y: Math.round(bounds.y + logicalY),
          confidence: cluster.points.length / redDots.length
        }
      }
    })

    console.log('[HasUnread] 扫描到红点:', {
      count: results.length,
      positions: results.map(r => ({ x: r.x, y: r.y })),
      totalRedPixels: redDots.length
    })

    return results
  } catch (error) {
    console.error('[HasUnread] 扫描联系人列表失败:', error)
    return []
  }
}

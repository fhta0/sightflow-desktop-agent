import { screen } from 'electron'
import activeWin from 'active-win'
import { AppType } from './types'
import { captureWechatWindow } from './screenshot-utils'

const IS_WINDOWS = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

// 包装带超时的 activeWin 调用
async function getOpenWindowsSafe(): Promise<any[]> {
  try {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('active-win getOpenWindows timeout')), 5000)
    })
    
    // 如果系统没有给权限，activeWin在某些版本可能卡死，强制5秒超时
    const windows = await Promise.race([
      activeWin.getOpenWindows(),
      timeoutPromise
    ])
    return windows as any[]
  } catch (err: any) {
    console.error('[window-utils] getOpenWindowsSafe error or timeout:', err.message)
    return []
  }
}

export function matchWechatType(name: string, appType: AppType) {
  if ((appType as string) === 'whatsapp') {
    return ['‎WhatsApp', '‎WhatsApp.app', '‎WhatsApp.exe', 'WhatsApp'].includes(name)
  }
  const wechatName =
    appType === 'wechat' ? ['微信', '微信.app', 'WeChat'] : ['企业微信', '企业微信.app']
  return wechatName.includes(name)
}

function getWechatWindow(appType: AppType, windows: any[]): any {
  let appTargetName: string[]
  let windowTitle: string[]

  if ((appType as string) === 'whatsapp') {
    appTargetName = ['‎WhatsApp', '‎WhatsApp.app', '‎WhatsApp.exe', 'WhatsApp']
    windowTitle = ['‎WhatsApp', '‎WhatsApp.app', '‎WhatsApp.exe', 'WhatsApp']
  } else {
    appTargetName =
      appType === 'wechat' ? ['微信', '微信.app', 'WeChat'] : ['企业微信', '企业微信.app']
    windowTitle = appType === 'wechat' ? ['微信', 'Weixin'] : ['企业微信']
  }

  const allWechatWindows = windows.filter((window: any) =>
    appTargetName.includes(window?.owner?.name)
  )

  if (allWechatWindows.length > 1) {
    const selected = allWechatWindows.find((window: any) => windowTitle.includes(window.title))
    return selected
  }
  if (allWechatWindows.length === 1) {
    return allWechatWindows[0]
  }
  return undefined
}

type PlatformWindow = {
  getBounds?: () => { x?: number; y?: number; width?: number; height?: number }
  bounds?: { x?: number; y?: number; width?: number; height?: number }
  [key: string]: any
}

async function getWechatWindowInWin(appType: AppType): Promise<PlatformWindow | null> {
  try {
    const { windowManager } = require('node-window-manager')
    let activeWechatWindow = windowManager.getActiveWindow()
    if (activeWechatWindow && matchWechatType(activeWechatWindow.getTitle(), appType)) {
      return activeWechatWindow
    }
    const foundWindow = windowManager.getWindows()
      ?.find((window: any) => matchWechatType(window.getTitle(), appType) && window.isVisible())
    return foundWindow || null
  } catch (err: any) {
    console.error('[window-utils] getWechatWindowInWin error:', err.message)
    return null
  }
}

async function getWechatWindowInMac(appType: AppType): Promise<PlatformWindow | null> {
  const windows = await getOpenWindowsSafe()
  if (!windows || windows.length === 0) {
    return null
  }
  return getWechatWindow(appType, windows) || null
}

function getWindowBounds(window: PlatformWindow): {
  x?: number
  y?: number
  width?: number
  height?: number
} | null {
  if (typeof window.getBounds === 'function') {
    return window.getBounds()
  }
  if (window.bounds) {
    return window.bounds
  }
  return null
}

function validateWindowBounds(bounds: { x?: number; y?: number; width?: number; height?: number } | null): bounds is { x: number; y: number; width: number; height: number } {
  if (!bounds) return false
  if (bounds.x === undefined || bounds.y === undefined || !bounds.width || !bounds.height ||
     (bounds.width && bounds.width < 100) || (bounds.height && bounds.height < 100)) {
    return false
  }
  const isVisible = bounds.width > 0 && bounds.height > 0
  return isVisible
}

interface WechatWindowInfoCache {
  result: any | null
  timestamp: number
}
const WINDOW_INFO_CACHE_DURATION = 5000 // 5 seconds cache
const wechatWindowInfoCache = new Map<AppType, WechatWindowInfoCache>()
const wechatWindowInfoPendingPromises = new Map<AppType, Promise<any>>()

export async function getWechatWindowInfo(appType: AppType) {
  const cached = wechatWindowInfoCache.get(appType)
  const now = Date.now()
  if (cached && now - cached.timestamp < WINDOW_INFO_CACHE_DURATION) {
    return cached.result
  }

  const pendingPromise = wechatWindowInfoPendingPromises.get(appType)
  if (pendingPromise) return pendingPromise

  const queryPromise = (async () => {
    try {
      const wechatWindow = IS_WINDOWS ? await getWechatWindowInWin(appType) : IS_MAC ? await getWechatWindowInMac(appType) : null
      if (!wechatWindow) return null

      const bounds = getWindowBounds(wechatWindow)
      if (!validateWindowBounds(bounds)) return null

      const display = screen.getDisplayMatching({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      })

      const result = {
        wechatWindow,
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        wechatType: appType,
        display: { id: display.id, scaleFactor: display.scaleFactor, bounds: display.bounds }
      }
      wechatWindowInfoCache.set(appType, { result, timestamp: Date.now() })
      return result
    } catch (e) {
      console.error('getWechatWindowInfo error:', e)
      return null
    } finally {
      wechatWindowInfoPendingPromises.delete(appType)
    }
  })()

  wechatWindowInfoPendingPromises.set(appType, queryPromise)
  return queryPromise
}

export const getWindowInfo = async (appType: AppType = 'wechat', includeScreenshot: boolean = true) => {
  if (!includeScreenshot) {
    const result = await getWechatWindowInfo(appType)
    if (!result) return null
    return {
      wechatWindow: result.wechatWindow,
      bounds: result.bounds,
      wechatType: result.wechatType,
      scaleFactor: result.display.scaleFactor
    }
  }

  try {
    const windowCore = await getWechatWindowInfo(appType)
    if (!windowCore) return null

    const result = await captureWechatWindow(appType)
    if (!result.success || !result.screenshotBase64) return null

    return {
      wechatWindow: windowCore.wechatWindow,
      bounds: result.bounds!,
      wechatType: windowCore.wechatType,
      scaleFactor: result.display!.scaleFactor,
      screenshot: result.screenshotBase64
    }
  } catch (error) {
    console.error('getWindowInfo failure:', error)
    return null
  }
}

/**
 * 同步获取窗口信息（从内存缓存读取，不发起系统调用）
 * 前提：measureLayout 时已经调过 getWindowInfo/getWechatWindowInfo，缓存有数据
 */
export function getWindowInfoSync(appType: AppType): {
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
} | null {
  const cached = wechatWindowInfoCache.get(appType)
  if (!cached?.result) return null

  return {
    bounds: cached.result.bounds,
    scaleFactor: cached.result.display?.scaleFactor || 1
  }
}

/**
 * 从窗口边界计算聊天区域
 * 微信左侧边栏固定宽度约 310~350px（导航 + 联系人列表）
 */
export function calcChatArea(bounds: { x: number; y: number; width: number; height: number }): {
  x: number
  y: number
  width: number
  height: number
} {
  const LEFT_SIDEBAR_WIDTH = 350  // 实测校准值

  return {
    x: bounds.x + LEFT_SIDEBAR_WIDTH,
    y: bounds.y,
    width: bounds.width - LEFT_SIDEBAR_WIDTH,
    height: bounds.height
  }
}

/**
 * 计算输入框点击坐标（相对于聊天区域）
 * 输入框位置：横向居中，垂直靠下（约 85% 高度处）
 */
export function getInputBoxCoords(bounds: { x: number; y: number; width: number; height: number }): [number, number] {
  const chatArea = calcChatArea(bounds)

  const INPUT_BOX_OFFSET = {
    widthRatio: 0.5,   // 横向居中
    heightRatio: 0.85  // 垂直靠下
  }

  return [
    Math.round(chatArea.x + chatArea.width * INPUT_BOX_OFFSET.widthRatio),
    Math.round(chatArea.y + chatArea.height * INPUT_BOX_OFFSET.heightRatio)
  ]
}

/**
 * 激活微信窗口（将其置于前台）
 * 用于确保自动化操作时微信窗口可见且可交互
 *
 * @param appType 应用类型（wechat/weework）
 * @returns 是否成功激活窗口
 */
export async function activateWechatWindow(appType: AppType = 'wechat'): Promise<boolean> {
  try {
    // Windows: 使用 node-window-manager 的 bringToTop
    if (IS_WINDOWS) {
      const { windowManager } = require('node-window-manager')
      const windows = windowManager.getWindows()

      // 找到微信窗口
      const wechatWindow = windows.find((window: any) =>
        matchWechatType(window.getTitle(), appType) && window.isVisible()
      )

      if (!wechatWindow) {
        console.error(`[activateWechatWindow] 未找到 ${appType} 窗口`)
        return false
      }

      // 将窗口置于前台
      wechatWindow.bringToTop()
      console.log(`[activateWechatWindow] 已激活 ${appType} 窗口 (Windows)`)
      return true
    }

    // macOS: 使用 AppleScript 激活应用
    if (IS_MAC) {
      const appName = appType === 'wechat' ? 'WeChat' : 'WeChat Work'
      const { exec } = require('child_process')
      const script = `tell application "${appName}" to activate`

      await new Promise<void>((resolve, reject) => {
        exec(`osascript -e '${script}'`, (error: any) => {
          if (error) {
            console.error('[activateWechatWindow] macOS AppleScript error:', error.message)
            reject(error)
          } else {
            console.log(`[activateWechatWindow] 已激活 ${appType} 窗口 (macOS)`)
            resolve()
          }
        })
      })
      return true
    }

    console.warn('[activateWechatWindow] 非Windows/macOS平台，无法激活窗口')
    return false
  } catch (err: any) {
    console.error('[activateWechatWindow] 激活窗口失败:', err.message)
    return false
  }
}

/**
 * Skill HTTP Server — 为 OpenClaw / Python 粘合层提供本地 HTTP 控制接口
 *
 * 仅监听 127.0.0.1，提供以下端点：
 * - POST /skill/start  — 启动智能体（SightFlow 内置引擎）
 * - POST /skill/pause  — 暂停智能体
 * - GET  /skill/status — 查询当前运行状态
 * - GET/POST /skill/autopilot — 查询/设置自动驾驶状态（Python 粘合层）
 * - POST /skill/send-message — 发送消息给联系人
 * - POST /skill/log — 接收粘合层日志并广播到 UI
 *
 * 所有调用都会路由到 SkillEngineController 提供的回调里执行。
 */
import * as http from 'http'
import { BrowserWindow } from 'electron'

const FIXED_PORT = 12680  // 固定端口，不再 fallback

export type SkillStartReason =
  | 'no_vision_key'
  | 'no_provider'
  | 'missing_required_field'
  | 'engine_failed'
  | 'already_running'
  | 'wizard_cancelled'

export type SkillPauseReason = 'not_running' | 'pause_failed'

export interface SkillStartResult {
  ok: boolean
  reason?: SkillStartReason
  message?: string
}

export interface SkillPauseResult {
  ok: boolean
  reason?: SkillPauseReason
  message?: string
}

export interface SendMessageRequest {
  contact: string   // 联系人备注名 或 群名
  message: string   // 要发送的消息文本
}

export interface SendMessageResponse {
  ok: boolean
  error?: 'contact_not_found' | 'send_failed' | 'operation_in_progress' | 'window_not_found' | 'missing_contact_or_message' | 'invalid_json'
  message?: string
  elapsed_ms?: number
}

export interface SendMessageResult {
  ok: boolean
  error?: string
  elapsed_ms?: number
}

export interface AutopilotStatus {
  enabled: boolean
}

export interface GlueLayerLog {
  type: 'receive' | 'reply' | 'skip' | 'error' | 'info'
  contact?: string
  content: string
  timestamp?: number
}

export interface SkillEngineControllerWithSend extends SkillEngineController {
  /** 发送消息给指定联系人 */
  sendMessage(contact: string, message: string): Promise<SendMessageResult>
}

export interface SkillEngineController {
  /** 启动引擎；返回业务级结果，不抛异常 */
  start(): Promise<SkillStartResult>
  /** 暂停引擎；返回业务级结果，不抛异常 */
  pause(): Promise<SkillPauseResult>
  /** 查询当前是否在运行 */
  isRunning(): boolean
}

let server: http.Server | null = null
let controller: SkillEngineController | null = null

/** 并发锁：同一时间只能有一个 start/pause 操作 */
let skillOperationLock = false

/** 自动驾驶状态：默认启用 */
let autopilotEnabled = true

/** 当前监听端口 */
let currentPort = FIXED_PORT

function jsonResponse(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>
): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  })
  res.end(JSON.stringify(body))
}

/** 读取 POST body（最大 4KB，支持较长消息） */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 4096) {
        req.destroy()
        reject(new Error('body_too_large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

const START_STATUS_MAP: Record<SkillStartReason, number> = {
  already_running: 409,
  no_vision_key: 400,
  no_provider: 400,
  missing_required_field: 400,
  engine_failed: 500,
  wizard_cancelled: 409
}

const PAUSE_STATUS_MAP: Record<SkillPauseReason, number> = {
  not_running: 409,
  pause_failed: 500
}

async function handleStart(res: http.ServerResponse): Promise<void> {
  if (!controller) {
    jsonResponse(res, 503, { ok: false, error: 'controller_unavailable' })
    return
  }

  if (skillOperationLock) {
    jsonResponse(res, 409, { ok: false, error: 'operation_in_progress' })
    return
  }

  if (controller.isRunning()) {
    jsonResponse(res, 409, { ok: false, error: 'already_running' })
    return
  }

  skillOperationLock = true
  try {
    const result = await controller.start()
    if (result.ok) {
      jsonResponse(res, 200, { ok: true })
    } else {
      const reason = result.reason || 'engine_failed'
      const status = START_STATUS_MAP[reason] ?? 500
      jsonResponse(res, status, {
        ok: false,
        error: reason,
        message: result.message
      })
    }
  } catch (error) {
    console.error('[Skill Server] start error:', error)
    jsonResponse(res, 500, { ok: false, error: 'engine_failed' })
  } finally {
    skillOperationLock = false
  }
}

async function handlePause(res: http.ServerResponse): Promise<void> {
  if (!controller) {
    jsonResponse(res, 503, { ok: false, error: 'controller_unavailable' })
    return
  }

  if (skillOperationLock) {
    jsonResponse(res, 409, { ok: false, error: 'operation_in_progress' })
    return
  }

  if (!controller.isRunning()) {
    jsonResponse(res, 409, { ok: false, error: 'not_running' })
    return
  }

  skillOperationLock = true
  try {
    const result = await controller.pause()
    if (result.ok) {
      jsonResponse(res, 200, { ok: true })
    } else {
      const reason = result.reason || 'pause_failed'
      const status = PAUSE_STATUS_MAP[reason] ?? 500
      jsonResponse(res, status, {
        ok: false,
        error: reason,
        message: result.message
      })
    }
  } catch (error) {
    console.error('[Skill Server] pause error:', error)
    jsonResponse(res, 500, { ok: false, error: 'pause_failed' })
  } finally {
    skillOperationLock = false
  }
}

function handleStatus(res: http.ServerResponse): void {
  if (!controller) {
    jsonResponse(res, 503, { ok: false, error: 'controller_unavailable' })
    return
  }
  jsonResponse(res, 200, {
    ok: true,
    status: controller.isRunning() ? 'running' : 'stopped',
    port: currentPort
  })
}

function handleAutopilotGet(res: http.ServerResponse): void {
  jsonResponse(res, 200, {
    ok: true,
    enabled: autopilotEnabled
  })
}

async function handleAutopilotSet(res: http.ServerResponse, body: string): Promise<void> {
  let request: { enabled: boolean }
  try {
    request = JSON.parse(body) as { enabled: boolean }
  } catch {
    jsonResponse(res, 400, { ok: false, error: 'invalid_json' })
    return
  }

  autopilotEnabled = request.enabled

  // 广播状态变化到所有窗口
  broadcastToAllWindows('autopilot:state', { enabled: autopilotEnabled })

  jsonResponse(res, 200, {
    ok: true,
    enabled: autopilotEnabled
  })
}

async function handleLog(res: http.ServerResponse, body: string): Promise<void> {
  let logEntry: GlueLayerLog
  try {
    logEntry = JSON.parse(body) as GlueLayerLog
  } catch {
    jsonResponse(res, 400, { ok: false, error: 'invalid_json' })
    return
  }

  // 添加时间戳（如果没有）
  if (!logEntry.timestamp) {
    logEntry.timestamp = Date.now()
  }

  // 广播日志到所有窗口
  broadcastToAllWindows('glue-layer:log', logEntry)

  jsonResponse(res, 200, { ok: true })
}

/** 广播消息到所有 BrowserWindow */
function broadcastToAllWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}

async function handleSendMessage(res: http.ServerResponse, body: string): Promise<void> {
  if (!controller) {
    jsonResponse(res, 503, { ok: false, error: 'controller_unavailable' })
    return
  }

  if (skillOperationLock) {
    jsonResponse(res, 409, { ok: false, error: 'operation_in_progress' })
    return
  }

  // 解析请求体
  let request: SendMessageRequest
  try {
    request = JSON.parse(body) as SendMessageRequest
  } catch {
    jsonResponse(res, 400, { ok: false, error: 'invalid_json' })
    return
  }

  if (!request.contact || !request.message) {
    jsonResponse(res, 400, { ok: false, error: 'missing_contact_or_message' })
    return
  }

  skillOperationLock = true
  const startTime = Date.now()

  try {
    const result = await (controller as SkillEngineControllerWithSend).sendMessage(request.contact, request.message)

    if (result.ok) {
      jsonResponse(res, 200, {
        ok: true,
        elapsed_ms: Date.now() - startTime
      })
    } else {
      jsonResponse(res, 500, {
        ok: false,
        error: result.error || 'send_failed',
        elapsed_ms: Date.now() - startTime
      })
    }
  } catch (error: any) {
    console.error('[Skill Server] send-message error:', error)
    jsonResponse(res, 500, {
      ok: false,
      error: 'send_failed',
      message: error?.message || String(error)
    })
  } finally {
    skillOperationLock = false
  }
}

async function requestHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const { method, url } = req

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    })
    res.end()
    return
  }

  try {
    if (url === '/skill/start' && method === 'POST') {
      await readBody(req)
      await handleStart(res)
    } else if (url === '/skill/pause' && method === 'POST') {
      await readBody(req)
      await handlePause(res)
    } else if (url === '/skill/status' && method === 'GET') {
      handleStatus(res)
    } else if (url === '/skill/autopilot' && method === 'GET') {
      handleAutopilotGet(res)
    } else if (url === '/skill/autopilot' && method === 'POST') {
      const body = await readBody(req)
      await handleAutopilotSet(res, body)
    } else if (url === '/skill/send-message' && method === 'POST') {
      const body = await readBody(req)
      await handleSendMessage(res, body)
    } else if (url === '/skill/log' && method === 'POST') {
      const body = await readBody(req)
      await handleLog(res, body)
    } else {
      jsonResponse(res, 404, { ok: false, error: 'not_found' })
    }
  } catch (error) {
    console.error('[Skill Server] 请求处理异常:', error)
    jsonResponse(res, 500, { ok: false, error: 'internal_error' })
  }
}

export function startSkillServer(engineController: SkillEngineControllerWithSend): void {
  if (server) {
    console.warn('[Skill Server] already started, skip')
    return
  }
  controller = engineController

  server = http.createServer((req, res) => {
    requestHandler(req, res).catch((error) => {
      console.error('[Skill Server] Unhandled error:', error)
      try {
        jsonResponse(res, 500, { ok: false, error: 'internal_error' })
      } catch {
        // response 可能已经发送
      }
    })
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Skill Server] 端口 ${FIXED_PORT} 已被占用，可能已有实例运行`)
      console.error('[Skill Server] 请关闭现有实例后再启动，或检查是否有其他程序占用该端口')
      // 退出进程，避免多实例
      process.exit(1)
    } else {
      console.error('[Skill Server] 启动失败:', err)
      process.exit(1)
    }
  })

  server.listen(FIXED_PORT, '127.0.0.1', () => {
    currentPort = FIXED_PORT
    console.log(`[Skill Server] 已启动，监听 http://127.0.0.1:${FIXED_PORT}`)
  })
}

/** 获取当前自动驾驶状态 */
export function getAutopilotEnabled(): boolean {
  return autopilotEnabled
}

/** 获取当前监听端口 */
export function getSkillServerPort(): number {
  return currentPort
}

export function stopSkillServer(): void {
  if (server) {
    server.close(() => {
      console.log('[Skill Server] 已关闭')
    })
    server = null
  }
  controller = null
  skillOperationLock = false
}

/**
 * Skill HTTP Server — 为 OpenClaw / Python 粘合层提供本地 HTTP 控制接口
 *
 * 仅监听 127.0.0.1，提供以下端点：
 * - POST /skill/start  — 启动智能体（SightFlow 内置引擎）
 * - POST /skill/pause  — 暂停智能体
 * - GET  /skill/status — 查询当前运行状态
 * - GET/POST /skill/autopilot — 查询/设置自动驾驶状态（Python 粘合层）
 * - POST /skill/send-message — 发送消息给联系人
 * - POST /skill/generate-reply — 使用配置的 Provider 生成回复（统一 AI 调用）
 * - POST /skill/log — 接收粘合层日志并广播到 UI
 * - POST /skill/alert — 接收粘合层告警并广播到 UI（去重 5 分钟）
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

export interface GenerateReplyRequest {
  context: string  // 消息上下文，如 "来自 付海涛 的私聊消息：下午好"
  target?: string  // 联系人/群名（可选，用于个性化）
}

export interface GenerateReplyResponse {
  ok: boolean
  reply?: string
  error?: string
  elapsed_ms?: number
}

export interface AutopilotStatus {
  enabled: boolean
}

export interface GlueLayerLog {
  type: 'receive' | 'reply' | 'skip' | 'error' | 'info' | 'monitor' | 'heartbeat'
  contact?: string
  content: string
  timestamp?: number
}

export interface AlertData {
  severity: 'critical' | 'warning' | 'info'
  code: string
  message: string
  timestamp: number
}

// Alert 去重 Map
const alertDedupMap = new Map<string, number>()  // code → lastShownTimestamp
const ALERT_DEDUP_MS = 5 * 60 * 1000  // 5 分钟

export interface SkillEngineControllerWithSend extends SkillEngineController {
  /** 发送消息给指定联系人 */
  sendMessage(contact: string, message: string): Promise<SendMessageResult>
  /** 使用配置的 Provider 生成回复 */
  generateReply(context: string, target?: string): Promise<GenerateReplyResponse>
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

/** Settings store accessor — injected by index.ts to avoid circular dependency */
export interface SettingsStoreAccessor {
  get(key: string, defaultValue?: any): any
  set(key: string, value: any): void
}

let settingsStore: SettingsStoreAccessor | null = null

/** 自动驾驶状态：从 store 初始化，默认禁用 */
let autopilotEnabled = false

/** 当前监听端口 */
let currentPort = FIXED_PORT

/** Allowed origins for CORS validation */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true  // non-browser clients (curl, glue-layer) have no Origin
  const lower = origin.toLowerCase()
  // Allow localhost dev servers
  if (lower.startsWith('http://127.0.0.1:') || lower.startsWith('http://localhost:')) return true
  // Allow Electron file:// and app:// protocols
  if (lower.startsWith('file://') || lower.startsWith('app://')) return true
  return false
}

function jsonResponse(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
  requestOrigin?: string
): void {
  const origin = requestOrigin ?? ''
  const allowed = isAllowedOrigin(origin || undefined)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // Omit ACAO header for disallowed origins — setting it to 'null' would match
  // sandboxed iframe Origin: null, partially defeating the CORS check.
  if (allowed) {
    headers['Access-Control-Allow-Origin'] = origin || '*'
  }
  res.writeHead(statusCode, headers)
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

async function handleStart(res: http.ServerResponse, requestOrigin?: string): Promise<void> {
  if (!controller) {
    jsonResponse(res, 503, { ok: false, error: 'controller_unavailable' }, requestOrigin)
    return
  }

  if (skillOperationLock) {
    jsonResponse(res, 409, { ok: false, error: 'operation_in_progress' }, requestOrigin)
    return
  }

  if (controller.isRunning()) {
    jsonResponse(res, 409, { ok: false, error: 'already_running' }, requestOrigin)
    return
  }

  skillOperationLock = true
  try {
    const result = await controller.start()
    if (result.ok) {
      jsonResponse(res, 200, { ok: true }, requestOrigin)
    } else {
      const reason = result.reason || 'engine_failed'
      const status = START_STATUS_MAP[reason] ?? 500
      jsonResponse(res, status, {
        ok: false,
        error: reason,
        message: result.message
      }, requestOrigin)
    }
  } catch (error) {
    console.error('[Skill Server] start error:', error)
    jsonResponse(res, 500, { ok: false, error: 'engine_failed' }, requestOrigin)
  } finally {
    skillOperationLock = false
  }
}

async function handlePause(res: http.ServerResponse, requestOrigin?: string): Promise<void> {
  if (!controller) {
    jsonResponse(res, 503, { ok: false, error: 'controller_unavailable' }, requestOrigin)
    return
  }

  if (skillOperationLock) {
    jsonResponse(res, 409, { ok: false, error: 'operation_in_progress' }, requestOrigin)
    return
  }

  if (!controller.isRunning()) {
    jsonResponse(res, 409, { ok: false, error: 'not_running' }, requestOrigin)
    return
  }

  skillOperationLock = true
  try {
    const result = await controller.pause()
    if (result.ok) {
      jsonResponse(res, 200, { ok: true }, requestOrigin)
    } else {
      const reason = result.reason || 'pause_failed'
      const status = PAUSE_STATUS_MAP[reason] ?? 500
      jsonResponse(res, status, {
        ok: false,
        error: reason,
        message: result.message
      }, requestOrigin)
    }
  } catch (error) {
    console.error('[Skill Server] pause error:', error)
    jsonResponse(res, 500, { ok: false, error: 'pause_failed' }, requestOrigin)
  } finally {
    skillOperationLock = false
  }
}

function handleStatus(res: http.ServerResponse, requestOrigin?: string): void {
  if (!controller) {
    jsonResponse(res, 503, { ok: false, error: 'controller_unavailable' }, requestOrigin)
    return
  }
  jsonResponse(res, 200, {
    ok: true,
    status: controller.isRunning() ? 'running' : 'stopped',
    port: currentPort
  }, requestOrigin)
}

function handleAutopilotGet(res: http.ServerResponse, requestOrigin?: string): void {
  jsonResponse(res, 200, {
    ok: true,
    enabled: autopilotEnabled
  }, requestOrigin)
}

async function handleAutopilotSet(res: http.ServerResponse, body: string, requestOrigin?: string): Promise<void> {
  let request: { enabled: boolean }
  try {
    request = JSON.parse(body) as { enabled: boolean }
  } catch {
    jsonResponse(res, 400, { ok: false, error: 'invalid_json' }, requestOrigin)
    return
  }

  autopilotEnabled = request.enabled

  // 持久化到 electron-store
  try {
    settingsStore?.set('autopilot.enabled', request.enabled)
  } catch (e) {
    console.error('[Skill Server] 持久化 autopilot 失败:', e)
  }

  // 广播状态变化到所有窗口
  broadcastToAllWindows('autopilot:state', { enabled: autopilotEnabled })

  jsonResponse(res, 200, {
    ok: true,
    enabled: autopilotEnabled
  }, requestOrigin)
}

async function handleLog(res: http.ServerResponse, body: string, requestOrigin?: string): Promise<void> {
  let logEntry: GlueLayerLog
  try {
    logEntry = JSON.parse(body) as GlueLayerLog
  } catch {
    jsonResponse(res, 400, { ok: false, error: 'invalid_json' }, requestOrigin)
    return
  }

  // 添加时间戳（如果没有）
  if (!logEntry.timestamp) {
    logEntry.timestamp = Date.now()
  }

  // 广播日志到所有窗口 - 手动序列化为 JSON 字符串避免 IPC 编码问题
  const logJson = JSON.stringify(logEntry)
  broadcastToAllWindows('glue-layer:log', logJson)

  jsonResponse(res, 200, { ok: true }, requestOrigin)
}

/** 广播消息到所有 BrowserWindow */
function broadcastToAllWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}

async function handleAlert(res: http.ServerResponse, body: string, requestOrigin?: string): Promise<void> {
  let alert: AlertData
  try {
    alert = JSON.parse(body) as AlertData
  } catch {
    jsonResponse(res, 400, { ok: false, error: 'invalid_json' }, requestOrigin)
    return
  }

  // 去重检查
  const lastShown = alertDedupMap.get(alert.code)
  if (lastShown && Date.now() - lastShown < ALERT_DEDUP_MS) {
    jsonResponse(res, 200, { ok: true, deduplicated: true }, requestOrigin)
    return
  }
  alertDedupMap.set(alert.code, Date.now())

  // 推送到所有窗口
  broadcastToAllWindows('wechat-agent:alert-pushed', alert)

  jsonResponse(res, 200, { ok: true }, requestOrigin)
}

async function handleSendMessage(res: http.ServerResponse, body: string, requestOrigin?: string): Promise<void> {
  if (!controller) {
    jsonResponse(res, 503, { ok: false, error: 'controller_unavailable' }, requestOrigin)
    return
  }

  // sendMessage 不需要并发锁，因为它是独立的发送操作
  // skillOperationLock 只用于 start/pause 操作

  // 解析请求体
  let request: SendMessageRequest
  try {
    request = JSON.parse(body) as SendMessageRequest
  } catch {
    jsonResponse(res, 400, { ok: false, error: 'invalid_json' }, requestOrigin)
    return
  }

  if (!request.contact || !request.message) {
    jsonResponse(res, 400, { ok: false, error: 'missing_contact_or_message' }, requestOrigin)
    return
  }

  const startTime = Date.now()

  try {
    const result = await (controller as SkillEngineControllerWithSend).sendMessage(request.contact, request.message)

    if (result.ok) {
      jsonResponse(res, 200, {
        ok: true,
        elapsed_ms: Date.now() - startTime
      }, requestOrigin)
    } else {
      jsonResponse(res, 500, {
        ok: false,
        error: result.error || 'send_failed',
        elapsed_ms: Date.now() - startTime
      }, requestOrigin)
    }
  } catch (error: any) {
    console.error('[Skill Server] send-message error:', error)
    jsonResponse(res, 500, {
      ok: false,
      error: 'send_failed',
      message: error?.message || String(error)
    }, requestOrigin)
  }
}

async function handleGenerateReply(res: http.ServerResponse, body: string, requestOrigin?: string): Promise<void> {
  if (!controller) {
    jsonResponse(res, 503, { ok: false, error: 'controller_unavailable' }, requestOrigin)
    return
  }

  // 解析请求体
  let request: GenerateReplyRequest
  try {
    request = JSON.parse(body) as GenerateReplyRequest
  } catch {
    jsonResponse(res, 400, { ok: false, error: 'invalid_json' }, requestOrigin)
    return
  }

  if (!request.context) {
    jsonResponse(res, 400, { ok: false, error: 'missing_context' }, requestOrigin)
    return
  }

  const startTime = Date.now()

  try {
    const result = await (controller as SkillEngineControllerWithSend).generateReply(
      request.context,
      request.target
    )

    if (result.ok) {
      jsonResponse(res, 200, {
        ok: true,
        reply: result.reply,
        elapsed_ms: Date.now() - startTime
      }, requestOrigin)
    } else {
      jsonResponse(res, 500, {
        ok: false,
        error: result.error || 'generate_failed',
        elapsed_ms: Date.now() - startTime
      }, requestOrigin)
    }
  } catch (error: any) {
    console.error('[Skill Server] generate-reply error:', error)
    jsonResponse(res, 500, {
      ok: false,
      error: 'generate_failed',
      message: error?.message || String(error)
    }, requestOrigin)
  }
}

async function requestHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const { method, url } = req
  const requestOrigin = req.headers.origin

  if (method === 'OPTIONS') {
    const allowed = isAllowedOrigin(requestOrigin)
    const headers: Record<string, string> = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
    if (allowed) {
      headers['Access-Control-Allow-Origin'] = requestOrigin || '*'
    }
    res.writeHead(204, headers)
    res.end()
    return
  }

  try {
    if (url === '/skill/start' && method === 'POST') {
      await readBody(req)
      await handleStart(res, requestOrigin)
    } else if (url === '/skill/pause' && method === 'POST') {
      await readBody(req)
      await handlePause(res, requestOrigin)
    } else if (url === '/skill/status' && method === 'GET') {
      handleStatus(res, requestOrigin)
    } else if (url === '/skill/autopilot' && method === 'GET') {
      handleAutopilotGet(res, requestOrigin)
    } else if (url === '/skill/autopilot' && method === 'POST') {
      const body = await readBody(req)
      await handleAutopilotSet(res, body, requestOrigin)
    } else if (url === '/skill/send-message' && method === 'POST') {
      const body = await readBody(req)
      await handleSendMessage(res, body, requestOrigin)
    } else if (url === '/skill/generate-reply' && method === 'POST') {
      const body = await readBody(req)
      await handleGenerateReply(res, body, requestOrigin)
    } else if (url === '/skill/log' && method === 'POST') {
      const body = await readBody(req)
      await handleLog(res, body, requestOrigin)
    } else if (url === '/skill/alert' && method === 'POST') {
      const body = await readBody(req)
      await handleAlert(res, body, requestOrigin)
    } else {
      jsonResponse(res, 404, { ok: false, error: 'not_found' }, requestOrigin)
    }
  } catch (error) {
    console.error('[Skill Server] 请求处理异常:', error)
    jsonResponse(res, 500, { ok: false, error: 'internal_error' }, requestOrigin)
  }
}

export function startSkillServer(
  engineController: SkillEngineControllerWithSend,
  store?: SettingsStoreAccessor
): void {
  if (server) {
    console.warn('[Skill Server] already started, skip')
    return
  }
  controller = engineController
  settingsStore = store ?? null

  // 从 store 初始化 autopilot 状态
  autopilotEnabled = settingsStore?.get('autopilot.enabled', false) ?? false

  server = http.createServer((req, res) => {
    requestHandler(req, res).catch((error) => {
      console.error('[Skill Server] Unhandled error:', error)
      try {
        jsonResponse(res, 500, { ok: false, error: 'internal_error' }, req.headers.origin)
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

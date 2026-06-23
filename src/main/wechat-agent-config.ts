// sightflow-desktop-agent/src/main/wechat-agent-config.ts
import { safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { setTimeout as sleep } from 'timers/promises'

// Windows: %APPDATA%\WeChatAgent\
// Fallback (非 Windows): ~/.wechat-agent/
const CONFIG_DIR = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'WeChatAgent')
  : path.join(os.homedir(), '.wechat-agent')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
const SUPPORTED_VERSION = 1

export interface WechatAgentConfig {
  version: number
  identity: {
    wxid: string
    names: string[]
  }
  groups: {
    monitor: Array<{ room_id: string; name: string }>
  }
  ai: {
    api_url: string
    api_key: string  // 存储时加密
    api_key_format: 'dpapi' | 'plaintext'
    model: string
  }
  advanced: {
    wx_cli_path: string
  }
}

export function getConfigPath(): string {
  return CONFIG_FILE
}

export function getConfigDir(): string {
  return CONFIG_DIR
}

/** 读取配置（解密 API Key） */
export function loadConfig(): WechatAgentConfig | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
    const data = JSON.parse(raw) as WechatAgentConfig

    // 解密 API Key
    if (data.ai?.api_key_format === 'dpapi' && data.ai?.api_key) {
      try {
        const encrypted = Buffer.from(data.ai.api_key, 'base64')
        data.ai.api_key = safeStorage.decryptString(encrypted)
      } catch (e) {
        console.error('[WechatAgentConfig] API Key 解密失败:', e)
        // 不覆盖 api_key，保留加密值；设置标志让 UI 提示用户
        ;(data as any)._decryptFailed = true
      }
    }
    return data
  } catch (e) {
    console.error('[WechatAgentConfig] 读取配置失败:', e)
    return null
  }
}

/** 写入配置（加密 API Key，原子写入） */
export async function saveConfig(config: WechatAgentConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    // 确保目录存在
    fs.mkdirSync(CONFIG_DIR, { recursive: true })

    // 加密 API Key
    const toWrite = { ...config }
    if (toWrite.ai?.api_key && safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(toWrite.ai.api_key)
      toWrite.ai.api_key = encrypted.toString('base64')
      toWrite.ai.api_key_format = 'dpapi'
    } else if (toWrite.ai) {
      toWrite.ai.api_key_format = 'plaintext'
    }

    toWrite.version = SUPPORTED_VERSION

    // 原子写入：写临时文件 → rename
    const tmpFile = `${CONFIG_FILE}.tmp.${process.pid}.${Date.now()}`
    fs.writeFileSync(tmpFile, JSON.stringify(toWrite, null, 2), 'utf-8')

    // Windows rename 可能因杀毒软件短暂锁定而失败，retry 3 次（指数退避）
    let lastError: Error | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fs.renameSync(tmpFile, CONFIG_FILE)
        return { ok: true }
      } catch (e) {
        lastError = e as Error
        await sleep(100 * Math.pow(2, attempt))  // 100ms, 200ms, 400ms
      }
    }

    // 3 次都失败，保留临时文件
    return { ok: false, error: `rename failed after 3 retries: ${lastError?.message}` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

import { execSync } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

const REQUIRED_WECHAT_VERSION = '4.1.9'

export interface WeChatInstallStatus {
  installed: boolean
  version: string | null
  installPath: string | null
  needsInstall: boolean
}

/** 检测微信安装状态和版本 */
export function detectWeChat(): WeChatInstallStatus {
  let installPath: string | null = null

  // 1. 尝试从注册表获取安装路径
  try {
    const regOutput = execSync(
      'reg query "HKCU\\Software\\Tencent\\WeChat" /v InstallPath',
      { encoding: 'utf-8', windowsHide: true }
    )
    const match = regOutput.split('\n')
      .find(line => line.includes('InstallPath'))
    if (match) {
      installPath = match.split('REG_SZ').pop()?.trim() || null
    }
  } catch {
    // Registry key not found
  }

  // 2. 尝试默认路径
  if (!installPath) {
    const defaultPaths = [
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Tencent', 'WeChat'),
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Tencent', 'WeChat'),
    ]
    for (const p of defaultPaths) {
      if (fs.existsSync(path.join(p, 'WeChat.exe'))) {
        installPath = p
        break
      }
    }
  }

  if (!installPath) {
    return { installed: false, version: null, installPath: null, needsInstall: true }
  }

  // 3. 获取版本
  const exePath = path.join(installPath, 'WeChat.exe')
  let version: string | null = null
  try {
    if (fs.existsSync(exePath)) {
      version = execSync(
        `powershell -Command "(Get-Item '${exePath}').VersionInfo.ProductVersion"`,
        { encoding: 'utf-8', windowsHide: true }
      ).trim() || null
    }
  } catch {
    // Failed to get version
  }

  const needsInstall = !version || !version.startsWith(REQUIRED_WECHAT_VERSION)
  return { installed: true, version, installPath, needsInstall }
}

/** 静默安装微信 */
export function installWeChat(installerPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      execSync(`"${installerPath}" /S`, {
        timeout: 120_000,
        windowsHide: false,
      })
      resolve(true)
    } catch (e) {
      console.error('[WeChatInstaller] Installation failed:', e)
      resolve(false)
    }
  })
}

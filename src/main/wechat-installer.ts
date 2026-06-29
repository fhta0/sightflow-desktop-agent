import { execSync } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

const REQUIRED_WECHAT_VERSION = '4.1.9'
const WECHAT_DOWNLOAD_URL = 'https://dldir1.qq.com/weixin/Windows/WeChatWin.exe'

export interface WeChatInstallStatus {
  installed: boolean
  version: string | null
  installPath: string | null
  needsInstall: boolean
  running: boolean
}

/** 检查微信进程是否在运行 */
function isWeChatRunning(): boolean {
  try {
    const output = execSync('tasklist /FI "IMAGENAME eq WeChat.exe" /NH', {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 5000
    })
    return output.includes('WeChat.exe')
  } catch {
    return false
  }
}

/** 尝试从注册表查找微信安装路径 */
function findWeChatFromRegistry(): string | null {
  // 按优先级检查多个注册表位置
  const registryKeys = [
    // HKCU（用户级安装）
    'HKCU\\Software\\Tencent\\WeChat',
    // HKLM 32-bit（系统级安装，32位系统或 WoW64）
    'HKLM\\SOFTWARE\\WOW6432Node\\Tencent\\WeChat',
    // HKLM 64-bit
    'HKLM\\SOFTWARE\\Tencent\\WeChat',
  ]

  for (const key of registryKeys) {
    for (const valueName of ['InstallPath', 'Path']) {
      try {
        const regOutput = execSync(
          `reg query "${key}" /v ${valueName}`,
          { encoding: 'utf-8', windowsHide: true, timeout: 5000 }
        )
        const match = regOutput.split('\n')
          .find(line => line.includes(valueName))
        if (match) {
          let installPath = match.split('REG_SZ').pop()?.trim() || null
          // 如果路径以 WeChat.exe 结尾，取目录
          if (installPath && installPath.toLowerCase().endsWith('wechat.exe')) {
            installPath = path.dirname(installPath)
          }
          if (installPath && fs.existsSync(installPath)) {
            return installPath
          }
        }
      } catch {
        // 这个注册表位置/值名不存在，继续尝试
      }
    }
  }

  return null
}

/** 在默认路径中查找微信 */
function findWeChatInDefaultPaths(): string | null {
  const programFilesDirs = [
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    process.env['ProgramFiles'] || 'C:\\Program Files',
    process.env['LOCALAPPDATA'] ? path.join(process.env['LOCALAPPDATA'], 'Programs') : null,
  ].filter(Boolean) as string[]

  // 也检查其他常见盘符
  const drives = ['C:', 'D:', 'E:', 'F:']
  for (const drive of drives) {
    const pf = path.join(drive, 'Program Files')
    const pf86 = path.join(drive, 'Program Files (x86)')
    if (!programFilesDirs.includes(pf)) programFilesDirs.push(pf)
    if (!programFilesDirs.includes(pf86)) programFilesDirs.push(pf86)
  }

  for (const dir of programFilesDirs) {
    const candidates = [
      path.join(dir, 'Tencent', 'WeChat'),
      path.join(dir, 'WeChat'),
      path.join(dir, 'Tencent'),
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(path.join(candidate, 'WeChat.exe'))) {
        return candidate
      }
    }
  }

  return null
}

/** 使用 where 命令查找 WeChat.exe（PATH 中的情况） */
function findWeChatInPath(): string | null {
  try {
    const whereOutput = execSync('where WeChat.exe', {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 5000
    }).trim()
    if (whereOutput) {
      const exePath = whereOutput.split('\n')[0].trim()
      if (exePath && fs.existsSync(exePath)) {
        return path.dirname(exePath)
      }
    }
  } catch {
    // WeChat.exe not in PATH
  }
  return null
}

/** 通过运行中的进程路径查找微信 */
function findWeChatFromProcess(): string | null {
  try {
    const output = execSync(
      'wmic process where "name=\'WeChat.exe\'" get ExecutablePath /value',
      { encoding: 'utf-8', windowsHide: true, timeout: 5000 }
    )
    const match = output.match(/ExecutablePath=(.+)/)
    if (match) {
      const exePath = match[1].trim()
      if (exePath && fs.existsSync(exePath)) {
        return path.dirname(exePath)
      }
    }
  } catch {
    // Failed to get process path
  }
  return null
}

/** 检测微信安装状态和版本 */
export function detectWeChat(): WeChatInstallStatus {
  let installPath: string | null = null
  const running = isWeChatRunning()

  // 如果微信正在运行，尝试从进程获取路径
  if (running) {
    installPath = findWeChatFromProcess()
  }

  // 1. 尝试从注册表获取安装路径（多个位置）
  if (!installPath) {
    installPath = findWeChatFromRegistry()
  }

  // 2. 尝试默认路径
  if (!installPath) {
    installPath = findWeChatInDefaultPaths()
  }

  // 3. 尝试 PATH 中查找
  if (!installPath) {
    installPath = findWeChatInPath()
  }

  if (!installPath) {
    return { installed: false, version: null, installPath: null, needsInstall: true, running }
  }

  // 4. 获取版本
  const exePath = path.join(installPath, 'WeChat.exe')
  let version: string | null = null
  if (fs.existsSync(exePath)) {
    try {
      version = execSync(
        `powershell -Command "(Get-Item '${exePath}').VersionInfo.ProductVersion"`,
        { encoding: 'utf-8', windowsHide: true, timeout: 10000 }
      ).trim() || null
    } catch {
      // Failed to get version via PowerShell, try alternative
      try {
        version = execSync(
          `wmic datafile where "name='${exePath.replace(/\\/g, '\\\\')}'" get Version /value`,
          { encoding: 'utf-8', windowsHide: true, timeout: 10000 }
        ).trim()
        if (version) {
          const match = version.match(/Version=(.+)/)
          version = match ? match[1].trim() : null
        }
      } catch {
        // Still failed
      }
    }
  }

  const needsInstall = !version || !version.startsWith(REQUIRED_WECHAT_VERSION)
  return { installed: true, version, installPath, needsInstall, running }
}

/** 获取微信下载地址 */
export function getWeChatDownloadUrl(): string {
  return WECHAT_DOWNLOAD_URL
}

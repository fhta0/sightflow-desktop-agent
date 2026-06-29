import { execSync } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

const REQUIRED_WECHAT_VERSION = '4.1.9'

export interface WeChatInstallStatus {
  installed: boolean
  version: string | null
  installPath: string | null
  needsInstall: boolean
  running: boolean
  downloadUrl: string
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
    // 尝试多个可能的值名称
    const valueNames = ['InstallPath', 'Path', 'InstallDir', 'exe_path']
    for (const valueName of valueNames) {
      try {
        const regOutput = execSync(
          `reg query "${key}" /v ${valueName}`,
          { encoding: 'utf-8', windowsHide: true, timeout: 5000 }
        )
        const match = regOutput.split('\n')
          .find(line => line.includes(valueName))
        if (match) {
          let installPath = match.split('REG_SZ').pop()?.trim() || null
          if (installPath) {
            // 如果路径以 WeChat.exe 结尾，取目录
            if (installPath.toLowerCase().endsWith('wechat.exe')) {
              installPath = path.dirname(installPath)
            }
            // 检查路径是否存在
            if (fs.existsSync(installPath)) {
              // 检查目录下是否有 WeChat.exe
              if (fs.existsSync(path.join(installPath, 'WeChat.exe'))) {
                return installPath
              }
              // 如果是安装根目录，WeChat.exe 可能在子目录
              const wechatSubdir = path.join(installPath, 'WeChat')
              if (fs.existsSync(path.join(wechatSubdir, 'WeChat.exe'))) {
                return wechatSubdir
              }
            }
          }
        }
      } catch {
        // 这个注册表位置/值名不存在，继续尝试
      }
    }
    // 也尝试查询默认值
    try {
      const regOutput = execSync(
        `reg query "${key}" /ve`,
        { encoding: 'utf-8', windowsHide: true, timeout: 5000 }
      )
      const match = regOutput.split('\n')
        .find(line => line.includes('REG_SZ'))
      if (match) {
        let installPath = match.split('REG_SZ').pop()?.trim() || null
        if (installPath && fs.existsSync(installPath)) {
          if (fs.existsSync(path.join(installPath, 'WeChat.exe'))) {
            return installPath
          }
        }
      }
    } catch {
      // 默认值不存在
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
    process.env['LOCALAPPDATA'] || '',
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
      path.join(dir, 'WeChat', 'Application'),
      path.join(dir, 'Tencent', 'WeChat', 'Application'),
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

/** 通过快捷方式查找微信 */
function findWeChatFromShortcuts(): string | null {
  const shortcutLocations = [
    path.join(process.env['APPDATA'] || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env['PUBLIC'] || 'C:\\Users\\Public', 'Desktop'),
    path.join(process.env['USERPROFILE'] || '', 'Desktop'),
  ]

  for (const location of shortcutLocations) {
    try {
      // 使用 PowerShell 查找快捷方式
      const output = execSync(
        `powershell -Command "Get-ChildItem -Path '${location}' -Recurse -Filter '*WeChat*.lnk' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName"`,
        { encoding: 'utf-8', windowsHide: true, timeout: 10000 }
      ).trim()

      if (output) {
        // 解析快捷方式目标
        const targetOutput = execSync(
          `powershell -Command "(New-Object -ComObject WScript.Shell).CreateShortcut('${output}').TargetPath"`,
          { encoding: 'utf-8', windowsHide: true, timeout: 5000 }
        ).trim()

        if (targetOutput && fs.existsSync(targetOutput)) {
          return path.dirname(targetOutput)
        }
      }
    } catch {
      // 快捷方式查找失败
    }
  }

  return null
}

/** 获取文件版本信息 */
function getFileVersion(exePath: string): string | null {
  try {
    const version = execSync(
      `powershell -Command "(Get-Item '${exePath}').VersionInfo.ProductVersion"`,
      { encoding: 'utf-8', windowsHide: true, timeout: 10000 }
    ).trim()
    if (version) return version
  } catch {
    // PowerShell 方式失败，尝试 wmic
  }

  try {
    const output = execSync(
      `wmic datafile where "name='${exePath.replace(/\\/g, '\\\\')}'" get Version /value`,
      { encoding: 'utf-8', windowsHide: true, timeout: 10000 }
    ).trim()
    const match = output.match(/Version=(.+)/)
    if (match) {
      return match[1].trim()
    }
  } catch {
    // wmic 方式失败
  }

  return null
}

/** 检测微信安装状态和版本 */
export function detectWeChat(): WeChatInstallStatus {
  let installPath: string | null = null
  const running = isWeChatRunning()

  // 如果微信正在运行，优先从进程获取路径
  if (running) {
    installPath = findWeChatFromProcess()
  }

  // 1. 尝试从注册表获取安装路径
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

  // 4. 尝试快捷方式查找
  if (!installPath) {
    installPath = findWeChatFromShortcuts()
  }

  if (!installPath) {
    return {
      installed: false,
      version: null,
      installPath: null,
      needsInstall: true,
      running,
      downloadUrl: ''
    }
  }

  // 获取版本
  const exePath = path.join(installPath, 'WeChat.exe')
  let version: string | null = null
  if (fs.existsSync(exePath)) {
    version = getFileVersion(exePath)
  }

  const needsInstall = !version || !version.startsWith(REQUIRED_WECHAT_VERSION)
  return {
    installed: true,
    version,
    installPath,
    needsInstall,
    running,
    downloadUrl: ''
  }
}

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
  isXWeChat: boolean  // 标记是否是新版微信 4.x（xwechat）
}

/** 检查微信进程是否在运行（支持旧版和新版） */
function isWeChatRunning(): { running: boolean; processName: string; exePath: string | null } {
  // 优先检查新版 WeChatAppEx.exe（xwechat 4.x）
  // 必须放在 WeChat.exe 之前：微信 4.x 同时存在两个进程，
  // 若先检测到 WeChat.exe（启动器），会误判为旧版
  try {
    const output = execSync('tasklist /FI "IMAGENAME eq WeChatAppEx.exe" /NH', {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 5000
    })
    if (output.includes('WeChatAppEx.exe')) {
      const exePath = findExeFromProcess('WeChatAppEx.exe')
      return { running: true, processName: 'WeChatAppEx.exe', exePath }
    }
  } catch { /* ignore */ }

  // 再检查旧版 WeChat.exe
  try {
    const output = execSync('tasklist /FI "IMAGENAME eq WeChat.exe" /NH', {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 5000
    })
    if (output.includes('WeChat.exe')) {
      const exePath = findExeFromProcess('WeChat.exe')
      return { running: true, processName: 'WeChat.exe', exePath }
    }
  } catch { /* ignore */ }

  return { running: false, processName: '', exePath: null }
}

/** 从进程获取 exe 路径 */
function findExeFromProcess(processName: string): string | null {
  try {
    const output = execSync(
      `wmic process where "name='${processName}'" get ExecutablePath /value`,
      { encoding: 'utf-8', windowsHide: true, timeout: 5000 }
    )
    const match = output.match(/ExecutablePath=(.+)/)
    if (match) {
      const exePath = match[1].trim()
      if (exePath && fs.existsSync(exePath)) {
        return exePath
      }
    }
  } catch { /* ignore */ }
  return null
}

/** 尝试从注册表查找微信安装路径（旧版微信） */
function findWeChatFromRegistry(): string | null {
  const registryKeys = [
    'HKCU\\Software\\Tencent\\WeChat',
    'HKLM\\SOFTWARE\\WOW6432Node\\Tencent\\WeChat',
    'HKLM\\SOFTWARE\\Tencent\\WeChat',
  ]

  for (const key of registryKeys) {
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
            if (installPath.toLowerCase().endsWith('wechat.exe')) {
              installPath = path.dirname(installPath)
            }
            if (fs.existsSync(installPath)) {
              if (fs.existsSync(path.join(installPath, 'WeChat.exe'))) {
                return installPath
              }
              const wechatSubdir = path.join(installPath, 'WeChat')
              if (fs.existsSync(path.join(wechatSubdir, 'WeChat.exe'))) {
                return wechatSubdir
              }
            }
          }
        }
      } catch { /* ignore */ }
    }
  }

  return null
}

/** 从 Uninstall 注册表查找微信 */
function findWeChatFromUninstallRegistry(): string | null {
  const uninstallKeys = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ]

  for (const baseKey of uninstallKeys) {
    try {
      // 列出所有子键
      const output = execSync(`reg query "${baseKey}" /s /f "微信"`, {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 10000
      })

      // 查找 InstallLocation 或 UninstallString
      const lines = output.split('\n')
      let installLocation: string | null = null
      let uninstallString: string | null = null

      for (const line of lines) {
        if (line.includes('InstallLocation') && line.includes('REG_SZ')) {
          installLocation = line.split('REG_SZ').pop()?.trim() || null
        }
        if (line.includes('UninstallString') && line.includes('REG_SZ')) {
          uninstallString = line.split('REG_SZ').pop()?.trim() || null
        }
      }

      if (installLocation && fs.existsSync(installLocation)) {
        return installLocation
      }
      if (uninstallString) {
        // 从卸载字符串提取路径
        const match = uninstallString.match(/"([^"]+)"/) || uninstallString.match(/^(\S+)/)
        if (match) {
          const exePath = match[1]
          const dir = path.dirname(exePath)
          if (fs.existsSync(dir)) {
            return dir
          }
        }
      }
    } catch { /* ignore */ }

    // 也搜索 wechat / xwechat
    try {
      const output = execSync(`reg query "${baseKey}" /s /f "wechat"`, {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 10000
      })

      const lines = output.split('\n')
      for (const line of lines) {
        if (line.includes('InstallLocation') && line.includes('REG_SZ')) {
          const installPath = line.split('REG_SZ').pop()?.trim() || null
          if (installPath && fs.existsSync(installPath)) {
            return installPath
          }
        }
      }
    } catch { /* ignore */ }
  }

  return null
}

/** 查找新版微信（xwechat 4.x）安装路径 */
function findXWeChatPath(): string | null {
  // 用户配置文件夹（通常在 C 盘）
  const userDirs = [
    process.env['APPDATA'] || '',
    process.env['LOCALAPPDATA'] || '',
    process.env['USERPROFILE'] || '',
  ].filter(Boolean)

  // 也搜索所有盘符
  const drives = ['C:', 'D:', 'E:', 'F:', 'G:']
  const allDirs: string[] = [...userDirs]

  for (const drive of drives) {
    // 常见的微信数据目录位置
    allDirs.push(path.join(drive, 'WeChat Files'))
    allDirs.push(path.join(drive, 'xwechat_files'))
    allDirs.push(path.join(drive, 'Program Files', 'Tencent', 'xwechat'))
    allDirs.push(path.join(drive, 'Program Files (x86)', 'Tencent', 'xwechat'))
    // 用户数据可能在这些位置
    allDirs.push(path.join(drive, 'Users', process.env['USERNAME'] || '', 'Documents', 'xwechat_files'))
    allDirs.push(path.join(drive, 'Users', process.env['USERNAME'] || '', 'AppData', 'Roaming', 'Tencent', 'xwechat'))
    allDirs.push(path.join(drive, 'Users', process.env['USERNAME'] || '', 'AppData', 'Local', 'Tencent', 'xwechat'))
  }

  for (const dir of allDirs) {
    if (dir && fs.existsSync(dir)) {
      // 检查是否是 xwechat 目录（包含特征文件/目录）
      const xwechatMarkers = ['xplugin', 'xwechat_files', 'WeChatAppEx.exe', 'config.json']
      for (const marker of xwechatMarkers) {
        if (fs.existsSync(path.join(dir, marker))) {
          return dir
        }
      }
    }
  }

  return null
}

/** 在默认路径中查找微信（支持旧版和新版） */
function findWeChatInDefaultPaths(): { path: string; isXWeChat: boolean } | null {
  const programFilesDirs = [
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    process.env['ProgramFiles'] || 'C:\\Program Files',
    process.env['LOCALAPPDATA'] ? path.join(process.env['LOCALAPPDATA'], 'Programs') : null,
    process.env['APPDATA'] || '',
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
    // 旧版微信路径
    const oldCandidates = [
      path.join(dir, 'Tencent', 'WeChat'),
      path.join(dir, 'WeChat'),
      path.join(dir, 'Tencent'),
      path.join(dir, 'WeChat', 'Application'),
      path.join(dir, 'Tencent', 'WeChat', 'Application'),
    ]
    for (const candidate of oldCandidates) {
      if (fs.existsSync(path.join(candidate, 'WeChat.exe'))) {
        return { path: candidate, isXWeChat: false }
      }
    }

    // 新版微信（xwechat）路径
    const xwechatCandidates = [
      path.join(dir, 'Tencent', 'xwechat'),
      path.join(dir, 'xwechat'),
      path.join(dir, 'Tencent', 'WeChatX'),
    ]
    for (const candidate of xwechatCandidates) {
      if (fs.existsSync(candidate)) {
        return { path: candidate, isXWeChat: true }
      }
    }
  }

  return null
}

/** 通过快捷方式查找微信 */
function findWeChatFromShortcuts(): string | null {
  const shortcutLocations = [
    path.join(process.env['APPDATA'] || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env['ProgramData'] || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu'),
    path.join(process.env['PUBLIC'] || 'C:\\Users\\Public', 'Desktop'),
    path.join(process.env['USERPROFILE'] || '', 'Desktop'),
  ]

  for (const location of shortcutLocations) {
    // 搜索中文和英文快捷方式
    for (const filter of ['*微信*', '*WeChat*', '*wechat*']) {
      try {
        const output = execSync(
          `powershell -Command "Get-ChildItem -Path '${location}' -Recurse -Filter '${filter}' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName"`,
          { encoding: 'utf-8', windowsHide: true, timeout: 10000 }
        ).trim()

        if (output && output.endsWith('.lnk')) {
          const targetOutput = execSync(
            `powershell -Command "(New-Object -ComObject WScript.Shell).CreateShortcut('${output}').TargetPath"`,
            { encoding: 'utf-8', windowsHide: true, timeout: 5000 }
          ).trim()

          if (targetOutput && fs.existsSync(targetOutput)) {
            return path.dirname(targetOutput)
          }
        }
      } catch { /* ignore */ }
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
  } catch { /* ignore */ }

  try {
    const output = execSync(
      `wmic datafile where "name='${exePath.replace(/\\/g, '\\\\')}'" get Version /value`,
      { encoding: 'utf-8', windowsHide: true, timeout: 10000 }
    ).trim()
    const match = output.match(/Version=(.+)/)
    if (match) {
      return match[1].trim()
    }
  } catch { /* ignore */ }

  return null
}

/** 全盘搜索微信（作为最后手段，使用 where /r 命令） */
function findWeChatByDiskSearch(): { path: string; isXWeChat: boolean } | null {
  const drives = ['C:', 'D:', 'E:', 'F:']

  for (const drive of drives) {
    // 搜索旧版 WeChat.exe
    try {
      const output = execSync(`where /r ${drive}\\ WeChat.exe 2>nul`, {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 30000
      }).trim()
      if (output) {
        const exePath = output.split('\n')[0].trim()
        if (exePath && fs.existsSync(exePath)) {
          return { path: path.dirname(exePath), isXWeChat: false }
        }
      }
    } catch { /* ignore */ }

    // 搜索新版 WeChatAppEx.exe
    try {
      const output = execSync(`where /r ${drive}\\ WeChatAppEx.exe 2>nul`, {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 30000
      }).trim()
      if (output) {
        const exePath = output.split('\n')[0].trim()
        if (exePath && fs.existsSync(exePath)) {
          // 找到 xwechat 的安装目录（向上查找 Tencent 目录）
          let dir = path.dirname(exePath)
          for (let i = 0; i < 10; i++) {
            const parent = path.dirname(dir)
            if (parent === dir) break
            const baseName = path.basename(parent).toLowerCase()
            if (baseName === 'xwechat' || baseName === 'tencent') {
              return { path: parent, isXWeChat: true }
            }
            dir = parent
          }
          return { path: path.dirname(exePath), isXWeChat: true }
        }
      }
    } catch { /* ignore */ }
  }

  return null
}

/** 检测微信安装状态和版本 */
export function detectWeChat(): WeChatInstallStatus {
  let installPath: string | null = null
  let isXWeChat = false

  const processInfo = isWeChatRunning()

  // 如果微信正在运行，优先从进程获取路径
  if (processInfo.running && processInfo.exePath) {
    const exeDir = path.dirname(processInfo.exePath)
    installPath = exeDir
    isXWeChat = processInfo.processName === 'WeChatAppEx.exe'

    // 对于 xwechat，尝试找到更上层的安装目录
    if (isXWeChat) {
      // 从 plugins/RadiumWMPF/.../runtime 往上找 Tencent/xwechat
      let dir = exeDir
      for (let i = 0; i < 10; i++) {
        const parent = path.dirname(dir)
        if (parent === dir) break
        if (path.basename(parent).toLowerCase() === 'xwechat' ||
            path.basename(parent).toLowerCase() === 'tencent') {
          installPath = parent
          break
        }
        dir = parent
      }
    }
  }

  // 1. 旧版微信：注册表查找
  if (!installPath) {
    const regPath = findWeChatFromRegistry()
    if (regPath) {
      installPath = regPath
      isXWeChat = false
    }
  }

  // 2. Uninstall 注册表查找（兼容所有版本）
  if (!installPath) {
    const uninstallPath = findWeChatFromUninstallRegistry()
    if (uninstallPath) {
      installPath = uninstallPath
    }
  }

  // 3. 默认路径查找（支持新旧版本）
  if (!installPath) {
    const defaultResult = findWeChatInDefaultPaths()
    if (defaultResult) {
      installPath = defaultResult.path
      isXWeChat = defaultResult.isXWeChat
    }
  }

  // 4. 快捷方式查找
  if (!installPath) {
    installPath = findWeChatFromShortcuts()
  }

  // 5. xwechat 数据目录查找
  if (!installPath) {
    const xwechatPath = findXWeChatPath()
    if (xwechatPath) {
      installPath = xwechatPath
      isXWeChat = true
    }
  }

  // 6. 全盘搜索（最后手段，可能较慢）
  if (!installPath) {
    const diskResult = findWeChatByDiskSearch()
    if (diskResult) {
      installPath = diskResult.path
      isXWeChat = diskResult.isXWeChat
    }
  }

  if (!installPath) {
    return {
      installed: false,
      version: null,
      installPath: null,
      needsInstall: true,
      running: processInfo.running,
      downloadUrl: '',
      isXWeChat: false
    }
  }

  // 获取版本
  let version: string | null = null
  if (isXWeChat) {
    // 新版微信：检查 xwechat 目录下的版本信息
    // 尝试找 WeChatAppEx.exe
    const candidates = [
      path.join(installPath, 'WeChatAppEx.exe'),
      path.join(installPath, 'runtime', 'WeChatAppEx.exe'),
      path.join(installPath, 'WeChat.exe'),
    ]
    for (const exePath of candidates) {
      if (fs.existsSync(exePath)) {
        version = getFileVersion(exePath)
        if (version) break
      }
    }
  } else {
    // 旧版微信
    const exePath = path.join(installPath, 'WeChat.exe')
    if (fs.existsSync(exePath)) {
      version = getFileVersion(exePath)
    }
  }

  // 对于新版微信，如果版本检测不到但进程在运行，认为已安装
  const needsInstall = isXWeChat
    ? false  // xwechat 不需要特定版本检查
    : (!version || !version.startsWith(REQUIRED_WECHAT_VERSION))

  return {
    installed: true,
    version,
    installPath,
    needsInstall,
    running: processInfo.running,
    downloadUrl: '',
    isXWeChat
  }
}

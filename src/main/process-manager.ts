import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'
import * as path from 'path'

export interface ProcessManagerCallbacks {
  onStatusChange: (status: GlueLayerStatus) => void
  onLog: (line: string) => void
}

export type GlueLayerStatus = 'stopped' | 'starting' | 'running' | 'crashed' | 'failed'

interface ProcessManagerOptions {
  executablePath: string
  wxCliPath: string
  sightflowPort: number
  configPath?: string
  callbacks: ProcessManagerCallbacks
}

const MAX_RESTART_ATTEMPTS = 3
const RESTART_DELAYS = [2000, 5000, 10000]

export class ProcessManager {
  private process: ChildProcess | null = null
  private restartCount = 0
  private options: ProcessManagerOptions
  private _status: GlueLayerStatus = 'stopped'

  constructor(options: ProcessManagerOptions) {
    this.options = options
  }

  get status(): GlueLayerStatus {
    return this._status
  }

  private setStatus(status: GlueLayerStatus): void {
    this._status = status
    this.options.callbacks.onStatusChange(status)
  }

  start(): void {
    if (this.process) {
      console.warn('[ProcessManager] glue-layer already running')
      return
    }
    this.setStatus('starting')
    this.restartCount = 0
    this.spawnProcess()
  }

  stop(): void {
    if (!this.process) return
    console.log('[ProcessManager] Stopping glue-layer...')
    this.process.removeAllListeners('exit')
    this.process.kill()
    this.process = null
    this.setStatus('stopped')
  }

  restart(): void {
    this.stop()
    this.restartCount = 0
    setTimeout(() => this.spawnProcess(), 500)
  }

  private spawnProcess(): void {
    const args: string[] = [
      '--wx-cli-path',
      this.options.wxCliPath,
      '--sightflow-port',
      String(this.options.sightflowPort)
    ]
    if (this.options.configPath) {
      args.push('--config', this.options.configPath)
    }

    console.log('[ProcessManager] Spawning:', this.options.executablePath, args.join(' '))

    try {
      this.process = spawn(this.options.executablePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false,
        cwd: path.dirname(this.options.wxCliPath)  // 设置工作目录为 wx-cli 所在目录
      })
    } catch (e) {
      console.error('[ProcessManager] spawn failed:', e)
      this.setStatus('failed')
      return
    }

    this.process.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString('utf-8').trim().split('\n')
      for (const line of lines) {
        if (line.trim()) {
          this.options.callbacks.onLog(line)
          console.log('[glue-layer]', line)
        }
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString('utf-8').trim().split('\n')
      for (const line of lines) {
        if (line.trim()) {
          this.options.callbacks.onLog(`[stderr] ${line}`)
          console.error('[glue-layer]', line)
        }
      }
    })

    this.process.on('exit', (code, signal) => {
      console.log(`[ProcessManager] glue-layer exited: code=${code}, signal=${signal}`)
      this.process = null
      if (code === 0) {
        this.setStatus('stopped')
        return
      }
      this.setStatus('crashed')
      this.scheduleRestart()
    })

    this.process.on('error', (err) => {
      console.error('[ProcessManager] process error:', err)
      this.setStatus('failed')
    })

    setTimeout(() => {
      if (this.process && !this.process.killed) {
        this.setStatus('running')
      }
    }, 1000)
  }

  private scheduleRestart(): void {
    if (this.restartCount >= MAX_RESTART_ATTEMPTS) {
      console.error('[ProcessManager] Max restart attempts reached')
      this.setStatus('failed')
      return
    }
    const delay = RESTART_DELAYS[this.restartCount] || RESTART_DELAYS[RESTART_DELAYS.length - 1]
    this.restartCount++
    console.log(
      `[ProcessManager] Restarting in ${delay}ms (attempt ${this.restartCount}/${MAX_RESTART_ATTEMPTS})`
    )
    setTimeout(() => {
      if (this._status === 'stopped') return
      this.spawnProcess()
    }, delay)
  }
}

export function getGlueLayerPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'glue-layer', 'glue-layer.exe')
  }
  return path.join(app.getAppPath(), 'resources', 'glue-layer', 'glue-layer.exe')
}

export function getWxCliPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'wx-cli', 'wx.exe')
  }
  return path.join(app.getAppPath(), 'resources', 'wx-cli', 'wx.exe')
}

export function getElevatePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'elevate.exe')
  }
  return path.join(app.getAppPath(), 'resources', 'elevate.exe')
}

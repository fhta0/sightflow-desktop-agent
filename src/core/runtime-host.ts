import {
  ChannelContext,
  ChannelSession,
  ProviderAdapter,
  RuntimeHostControls,
  SessionEvent
} from './session-types'
import { AppType } from './rpa/types'

interface RuntimeHostOptions<TState> {
  appType: AppType
  channel: ChannelSession<TState>
  provider: ProviderAdapter
  initialState: TState
  onLog?: (type: 'thinking' | 'reply' | 'skip' | 'error', content: string) => void
  // 引擎彻底停止（bootstrap 失败 / 内部 runtime_error / 主动 stopSession）时触发。
  // 用于让 startEngineCore 同步清理 _engineBusy，避免 send-message 永久 409。
  onSessionStopped?: () => void
}

export class RuntimeHost<TState> {
  private running = false
  private stopping = false
  private processingQueue = false
  private readonly queue: SessionEvent[] = []
  private readonly timers = new Set<NodeJS.Timeout>()
  private readonly context: ChannelContext<TState>

  constructor(private readonly options: RuntimeHostOptions<TState>) {
    this.context = {
      appType: options.appType,
      state: options.initialState,
      host: this.createControls()
    }
  }

  async startSession(): Promise<void> {
    if (this.running) return

    this.running = true
    this.stopping = false
    this.log('reply', '引擎已启动')

    try {
      await this.options.channel.onStart(this.context)
    } catch (error: any) {
      this.log('error', error?.message || String(error))
      await this.stopSession('start_failed')
      throw error
    }
    // 不再 await 引擎结束 —— 保持原语义，让 /skill/start 立即返回。
    // 真正的"引擎结束"信号由 onSessionStopped 回调通知外部。
  }

  async stopSession(_reason?: string): Promise<void> {
    if (!this.running || this.stopping) return

    this.stopping = true
    this.running = false

    for (const timer of this.timers) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.queue.length = 0

    try {
      await this.options.channel.onStop(this.context)
    } finally {
      this.processingQueue = false
      this.stopping = false
      this.log('skip', '引擎已停止')
      this.options.onSessionStopped?.()
    }
  }

  isRunning(): boolean {
    return this.running
  }

  updateAppType(appType: AppType): void {
    this.context.appType = appType
  }

  private createControls(): RuntimeHostControls {
    return {
      enqueue: (event) => this.enqueue(event),
      schedule: (event, delayMs) => this.schedule(event, delayMs),
      runProvider: (input) => this.options.provider.run(input),
      log: (type, content) => this.log(type, content),
      isRunning: () => this.running,
      stopSession: async (reason?: string) => this.stopSession(reason)
    }
  }

  private enqueue(event: SessionEvent): void {
    if (!this.running) return

    this.queue.push(event)
    void this.drainQueue()
  }

  private schedule(event: SessionEvent, delayMs: number): void {
    if (!this.running) return

    const timer = setTimeout(() => {
      this.timers.delete(timer)
      this.enqueue(event)
    }, delayMs)

    this.timers.add(timer)
  }

  private async drainQueue(): Promise<void> {
    if (this.processingQueue || !this.running) return

    this.processingQueue = true
    try {
      while (this.queue.length > 0 && this.running) {
        const event = this.queue.shift()
        if (!event) continue

        await this.options.channel.onEvent(event, this.context)
      }
    } catch (error: any) {
      this.log('error', error?.message || String(error))
      await this.stopSession('runtime_error')
    } finally {
      this.processingQueue = false
    }
  }

  private log(type: 'thinking' | 'reply' | 'skip' | 'error', content: string): void {
    if (this.options.onLog) {
      this.options.onLog(type, content)
    } else {
      console.log(`[RuntimeHost] [${type}] ${content}`)
    }
  }
}

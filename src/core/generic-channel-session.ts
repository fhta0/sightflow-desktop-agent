// src/core/generic-channel-session.ts
// 通用 ChannelSession — 驱动 DesktopDevice，具体位置来源由设备测量后写入 LayoutCache。
//
// 设计原则：本文件只依赖 DesktopDevice 接口。所有微信特定的行为（如 layoutCache 清理、
// VLM bbox 状态同步）都封装到具体设备的 onSessionStart / onSessionStop / clearUnreadCache
// 里，使 channel session 在不同设备之间真正可复用。

import { DesktopDevice } from './device'
import { ChannelContext, ChannelSession, ProviderEvent, SessionEvent } from './session-types'

export interface GenericChannelState {
  measuredAt: number | null
  latestChatBaseline: number | null
  pendingRedDots: Array<{ x: number; y: number }> | null
}

export function createInitialGenericChannelState(): GenericChannelState {
  return {
    measuredAt: null,
    latestChatBaseline: null,
    pendingRedDots: null
  }
}

export class GenericChannelSession implements ChannelSession<GenericChannelState> {
  private readonly retryDelayMs = 5000
  private consecutiveUnreadFailures = 0

  constructor(private readonly device: DesktopDevice) {}

  async onStart(ctx: ChannelContext<GenericChannelState>): Promise<void> {
    this.device.setAppType(ctx.appType)
    this.device.clearChatBaseline()
    this.consecutiveUnreadFailures = 0
    this.resetState(ctx.state)
    await this.device.onSessionStart?.()
    ctx.host.enqueue({ type: 'bootstrap' })
  }

  async onStop(ctx: ChannelContext<GenericChannelState>): Promise<void> {
    this.device.clearChatBaseline()
    this.consecutiveUnreadFailures = 0
    await this.device.onSessionStop?.()
    this.resetState(ctx.state)
  }

  async onEvent(event: SessionEvent, ctx: ChannelContext<GenericChannelState>): Promise<void> {
    this.device.setAppType(ctx.appType)

    switch (event.type) {
      case 'bootstrap': {
        ctx.host.log('thinking', '正在识别聊天窗口布局...')
        const result = await this.device.measureLayout()

        if (!result.success) {
          ctx.host.log('error', `${result.error || '界面识别失败'}，引擎无法启动`)
          await ctx.host.stopSession('bootstrap_failed')
          return
        }

        ctx.state.measuredAt = Date.now()
        ctx.host.log('thinking', '聊天窗口识别完成')
        ctx.host.enqueue({ type: 'observe_chat' })
        break
      }

      case 'observe_chat': {
        const screenshot = await this.device.screenshot()
        void this.forwardProviderEvents(screenshot, ctx)
        break
      }

      case 'provider.thinking':
        ctx.host.log('thinking', event.content)
        break

      case 'provider.reply_text':
        await this.device.sendMessage(event.content)
        ctx.host.log('reply', event.content)
        await this.device.setChatBaseline()
        ctx.state.latestChatBaseline = Date.now()
        ctx.host.enqueue({ type: 'check_unread' })
        break

      case 'provider.skip':
        ctx.host.log('skip', '本轮无需回复')
        await this.device.setChatBaseline()
        ctx.state.latestChatBaseline = Date.now()
        ctx.host.enqueue({ type: 'check_unread' })
        break

      case 'provider.error':
        ctx.host.log('error', `回复服务异常：${event.error}`)
        ctx.host.enqueue({
          type: 'wait_retry',
          reason: 'provider_error',
          delayMs: this.retryDelayMs
        })
        break

      case 'check_unread': {
        // 首先检查是否有待处理的红点队列
        if (ctx.state.pendingRedDots && ctx.state.pendingRedDots.length > 0) {
          const nextRedDot = ctx.state.pendingRedDots.shift()!
          ctx.host.log(
            'thinking',
            `处理待办红点 (${ctx.state.pendingRedDots.length + 1} 个中的第 1 个)`
          )
          await this.device.clickUnreadContact([nextRedDot.x, nextRedDot.y])
          await this.sleep(500 + Math.random() * 300)
          this.device.clearChatBaseline()
          ctx.state.latestChatBaseline = null

          // 如果是最后一个红点，跳过再次扫描直接粗检测
          // 避免服务号等不会消红点的入口导致无限循环
          if (ctx.state.pendingRedDots.length === 0) {
            ctx.host.log('thinking', '所有可见红点已处理，进行全局检测')
            ctx.host.enqueue({ type: 'check_unread_skip_scan' })
          } else {
            ctx.host.enqueue({ type: 'observe_chat' })
          }
          break
        }

        // 检查当前对话是否有新消息
        const diffResult = await this.device.hasChatAreaChanged()
        if (diffResult.hasDiff) {
          ctx.host.log('thinking', '检测到当前对话有新消息')
          ctx.host.enqueue({ type: 'observe_chat' })
          break
        }

        // 第一步：扫描联系人列表区域寻找所有红点
        ctx.host.log('thinking', '扫描联系人列表寻找未读消息...')
        const redDots = await this.device.scanContactListForRedDots()

        if (redDots.length > 0) {
          // 找到红点，先处理第一个，其余的存入队列
          ctx.host.log(
            'thinking',
            `发现 ${redDots.length} 个有未读消息的联系人，开始处理`
          )

          const firstRedDot = redDots[0]
          // 如果有更多红点，存入状态
          if (redDots.length > 1) {
            ctx.state.pendingRedDots = redDots.slice(1)
            ctx.host.log(
              'thinking',
              `已缓存 ${ctx.state.pendingRedDots.length} 个待处理红点`
            )
          }

          // 点击第一个红点联系人
          await this.device.clickUnreadContact([firstRedDot.x, firstRedDot.y])
          await this.sleep(500 + Math.random() * 300)
          this.device.clearChatBaseline()
          ctx.state.latestChatBaseline = null

          // 如果只有一个红点，处理完后跳过再次扫描
          if (redDots.length === 1) {
            ctx.host.log('thinking', '唯一可见红点已处理，进行全局检测')
            ctx.host.enqueue({ type: 'check_unread_skip_scan' })
          } else {
            ctx.host.enqueue({ type: 'observe_chat' })
          }
          break
        }

        // 当前窗口没有可见红点，进行粗检测
        ctx.host.log('thinking', '当前列表无可见红点，进行全局检测...')
        const unreadResult = await this.device.hasUnreadMessage()
        if (!unreadResult.hasUnread) {
          ctx.host.enqueue({
            type: 'wait_retry',
            reason: 'no_unread',
            delayMs: this.retryDelayMs
          })
          break
        }

        // 有全局未读，但当前列表看不到，可能是需要滚动或折叠状态
        const chatEntranceCoords = unreadResult.chatEntranceArea?.coordinates
        if (!chatEntranceCoords) {
          ctx.host.log('error', '检测到未读消息，但未找到聊天入口位置')
          ctx.host.enqueue({
            type: 'wait_retry',
            reason: 'missing_chat_entrance',
            delayMs: this.retryDelayMs
          })
          break
        }

        ctx.host.log('thinking', '检测到未读消息，展开联系人列表')
        await this.device.activeUnreadByClick(chatEntranceCoords)
        await this.sleep(500 + Math.random() * 300)

        // 再次扫描联系人列表
        const redDotsAfterExpand = await this.device.scanContactListForRedDots()
        if (redDotsAfterExpand.length > 0) {
          const firstRedDot = redDotsAfterExpand[0]
          if (redDotsAfterExpand.length > 1) {
            ctx.state.pendingRedDots = redDotsAfterExpand.slice(1)
          }
          await this.device.clickUnreadContact([firstRedDot.x, firstRedDot.y])
          await this.sleep(500 + Math.random() * 300)
          this.device.clearChatBaseline()
          ctx.state.latestChatBaseline = null
          ctx.host.enqueue({ type: 'observe_chat' })
        } else {
          // 仍然找不到，使用传统方法
          const openResult = await this.tryOpenUnreadConversation(ctx)
          if (openResult === 'opened') {
            ctx.host.enqueue({ type: 'observe_chat' })
          } else {
            ctx.host.enqueue({
              type: 'wait_retry',
              reason: openResult,
              delayMs: this.retryDelayMs
            })
          }
        }
        break
      }

      case 'check_unread_skip_scan': {
        // 跳过扫描，直接粗检测
        // 用于服务号等不会消红点的入口，避免扫描→点击→同样红点的无限循环
        const unreadResult = await this.device.hasUnreadMessage()
        if (!unreadResult.hasUnread) {
          ctx.host.log('thinking', '全局检测无未读消息')
          ctx.host.enqueue({
            type: 'wait_retry',
            reason: 'no_unread',
            delayMs: this.retryDelayMs
          })
          break
        }

        // 有未读但扫描区域看不到，展开再扫
        const chatEntranceCoords = unreadResult.chatEntranceArea?.coordinates
        if (chatEntranceCoords) {
          ctx.host.log('thinking', '检测到未读消息，展开联系人列表')
          await this.device.activeUnreadByClick(chatEntranceCoords)
          await this.sleep(500 + Math.random() * 300)
        }
        ctx.host.enqueue({ type: 'check_unread' })
        break
      }

      case 'wait_retry':
        ctx.host.log('skip', '等待下一轮未读检测')
        ctx.host.schedule(
          event.reason === 'provider_error' ? { type: 'observe_chat' } : { type: 'check_unread' },
          event.delayMs ?? this.retryDelayMs
        )
        break
    }
  }

  private async forwardProviderEvents(
    screenshot: string,
    ctx: ChannelContext<GenericChannelState>
  ): Promise<void> {
    try {
      for await (const event of ctx.host.runProvider({
        screenshot,
        appType: ctx.appType
      })) {
        if (!ctx.host.isRunning()) break

        const sessionEvent = this.mapProviderEvent(event)
        if (sessionEvent) {
          ctx.host.enqueue(sessionEvent)
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.host.enqueue({ type: 'provider.error', error: message })
    }
  }

  private mapProviderEvent(event: ProviderEvent): SessionEvent | null {
    switch (event.type) {
      case 'thinking':
        return { type: 'provider.thinking', content: event.content }
      case 'reply_text':
        return { type: 'provider.reply_text', content: event.content }
      case 'skip':
        return { type: 'provider.skip' }
      case 'error':
        return { type: 'provider.error', error: event.error }
      default:
        return null
    }
  }

  private resetState(state: GenericChannelState): void {
    state.measuredAt = null
    state.latestChatBaseline = null
    state.pendingRedDots = null
  }

  private async tryOpenUnreadConversation(
    ctx: ChannelContext<GenericChannelState>
  ): Promise<'opened' | 'contact_not_ready'> {
    let contactResult = await this.device.isChatContactUnread()

    if (!contactResult.isUnread) {
      ctx.host.log('thinking', '当前会话没有新消息，正在重新检测...')
      await this.sleep(1000)

      const recheckResult = await this.device.hasUnreadMessage()
      const recheckCoords = recheckResult.chatEntranceArea?.coordinates

      if (!recheckResult.hasUnread || !recheckCoords) {
        ctx.host.log('skip', '重新检测后无未读消息，等待下一轮')
        return 'contact_not_ready'
      }

      ctx.host.log('thinking', '仍检测到未读消息，正在再次尝试打开会话')
      await this.device.activeUnreadByClick(recheckCoords)
      await this.sleep(500)
      contactResult = await this.device.isChatContactUnread()
    }

    if (!contactResult.isUnread) {
      this.consecutiveUnreadFailures += 1

      if (this.consecutiveUnreadFailures >= 3) {
        ctx.host.log(
          'thinking',
          `连续 ${this.consecutiveUnreadFailures} 次检测失败，正在重置未读识别状态`
        )
        this.device.clearUnreadCache()
        this.consecutiveUnreadFailures = 0
        await this.sleep(500)

        contactResult = await this.device.isChatContactUnread()
        if (!contactResult.isUnread) {
          ctx.host.log('thinking', '重置后仍未成功，正在再次尝试打开会话')
          const retryUnread = await this.device.hasUnreadMessage()
          const retryCoords = retryUnread.chatEntranceArea?.coordinates

          if (!retryUnread.hasUnread || !retryCoords) {
            ctx.host.log('skip', '重置后仍未找到可用会话入口，等待下一轮')
            return 'contact_not_ready'
          }

          await this.device.activeUnreadByClick(retryCoords)
          await this.sleep(500)
          contactResult = await this.device.isChatContactUnread()

          if (!contactResult.isUnread) {
            ctx.host.log('skip', '最终检测仍失败，放弃当前轮未读切换')
            return 'contact_not_ready'
          }
        }
      } else {
        ctx.host.log(
          'skip',
          `会话切换检测失败（第 ${this.consecutiveUnreadFailures} 次），等待下一轮`
        )
        return 'contact_not_ready'
      }
    }

    this.consecutiveUnreadFailures = 0

    if (!contactResult.firstContactCoords) {
      ctx.host.log('skip', '未找到联系人位置，等待下一轮')
      return 'contact_not_ready'
    }

    ctx.host.log('thinking', '正在打开未读会话')
    await this.device.clickUnreadContact(contactResult.firstContactCoords)
    await this.sleep(500 + Math.random() * 300)
    this.device.clearChatBaseline()
    ctx.state.latestChatBaseline = null
    return 'opened'
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

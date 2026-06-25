import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { t } from './i18n'
import logoUrl from './assets/logo.png'
import { WechatAgentSettings } from './WechatAgentSettings'
import { OnboardingWizard } from './OnboardingWizard'
import { LogViewer } from './LogViewer'
import { AlertData } from './types'
import './index.css'

interface LogEntry {
  time: string
  type: 'receive' | 'reply' | 'skip' | 'error' | 'info' | 'thinking' | 'monitor' | 'heartbeat'
  contact?: string
  content: string
}

type SettingsSection = 'base' | 'agent' | 'wechat-agent' | 'logs'
type AppType = 'wechat' | 'wework' | 'dingtalk' | 'lark' | 'slack' | 'telegram' | 'generic'

interface AppSettings {
  locale: 'zh' | 'en'
  appType: AppType
  vision: {
    apiKey: string
  }
  chatProvider: {
    manifestUrl: string
    installed: InstalledProviderInfo | null
    config: Record<string, any>
  }
  defaultCaptureStrategy: 'auto' | 'vlm' | 'box-select'
  capture: Partial<Record<AppType, any>>
}

interface InstalledProviderInfo {
  id: string
  name: string
  version: string
  entryFile: string
  installedAt: string
}

type ProviderConfigFieldType = 'text' | 'password' | 'url' | 'select' | 'textarea'

interface ProviderConfigField {
  key: string
  label: string
  type: ProviderConfigFieldType
  required?: boolean
  readonly?: boolean
  placeholder?: string
  hint?: string
  defaultValue?: string
  options?: Array<{ label: string; value: string }>
}

interface ProviderCatalogItem {
  id: string
  name: string
  description?: string
  version: string
  manifestUrl: string
  capabilities?: string[]
  configSchema: {
    fields: ProviderConfigField[]
  }
}

interface ProviderHubCache {
  sourceUrl: string
  fetchedAt: string
  providers: ProviderCatalogItem[]
}

interface ProviderHubResult {
  success: boolean
  error?: string
  catalog?: ProviderHubCache | null
}

const BUILTIN_PROVIDER_CATALOG: ProviderCatalogItem[] = [
  {
    id: 'doubao',
    name: '豆包 Seed',
    description: '本地内置聊天 Provider，使用基础配置中的火山方舟密钥。',
    version: '1.0.0',
    manifestUrl: 'builtin://doubao',
    capabilities: ['chat'],
    configSchema: {
      fields: [
        {
          key: 'apiKey',
          label: 'API Key',
          type: 'password',
          required: true,
          placeholder: '输入火山方舟 API Key'
        },
        {
          key: 'model',
          label: '模型',
          type: 'text',
          required: true,
          readonly: true,
          defaultValue: 'doubao-seed-2-0-lite-260428'
        },
        {
          key: 'baseURL',
          label: 'Base URL',
          type: 'url',
          placeholder: 'https://ark.cn-beijing.volces.com/api/plan/v3'
        },
        {
          key: 'systemPrompt',
          label: '系统提示词',
          type: 'textarea',
          placeholder: '你是一个微信自动回复助手。根据截图中的聊天内容，生成合适的回复...'
        }
      ]
    }
  }
]

const GearIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

const RefreshIcon = (): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 0 1-15.1 6.6" />
    <path d="M3 12A9 9 0 0 1 18.1 5.4" />
    <path d="M18 2v4h-4" />
    <path d="M6 22v-4h4" />
  </svg>
)

function App() {
  const isSettingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings'

  if (isSettingsWindow) {
    return (
      <div className="app settings-window">
        <SettingsWindow />
        <Toast />
      </div>
    )
  }

  return (
    <div className="app">
      <div className="app-content">
        <ControlPanel />
      </div>

      <BottomBar />

      <Toast />
    </div>
  )
}

function ControlPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [autopilotEnabled, setAutopilotEnabled] = useState(true)
  const [serverPort, setServerPort] = useState(12680)
  const [currentAlert, setCurrentAlert] = useState<AlertData | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingChecked, setOnboardingChecked] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const listenerAttached = useRef(false)

  // 检查是否需要引导（首次启动）
  useEffect(() => {
    if (onboardingChecked) return
    void (async () => {
      try {
        const config = await window.electron?.invoke('wechat-agent:loadConfig')
        if (!config || !config.identity?.wxid) {
          setShowOnboarding(true)
        }
      } catch {
        // 加载失败时也显示引导
        setShowOnboarding(true)
      }
      setOnboardingChecked(true)
    })()
  }, [onboardingChecked])

  // 监听粘合层日志（防止 HMR 导致重复注册）
  useEffect(() => {
    if (listenerAttached.current) return
    listenerAttached.current = true

    const cleanupLog = window.electron?.on('glue-layer:log', (data: string) => {
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data
        const time = new Date().toLocaleTimeString('en-US', { hour12: false })
        setLogs((prev) => [...prev.slice(-99), { ...parsed, time }])
      } catch (e) {
        console.error('Failed to parse log:', e)
      }
    })

    // 监听告警事件
    const cleanupAlert = window.electron?.on('wechat-agent:alert-pushed', (alert: AlertData) => {
      setCurrentAlert(alert)
      // 系统通知
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('微信 Agent 告警', { body: alert.message })
      }
    })

    // 请求通知权限
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    return () => {
      cleanupLog?.()
      cleanupAlert?.()
    }
  }, [])

  // 监听自动驾驶状态变化
  useEffect(() => {
    const cleanup = window.electron?.on('autopilot:state', (data: { enabled: boolean }) => {
      setAutopilotEnabled(data.enabled)
    })
    return cleanup
  }, [])

  // 初始获取自动驾驶状态
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('http://127.0.0.1:12680/skill/autopilot')
        if (response.ok) {
          const data = await response.json()
          setAutopilotEnabled(data.enabled)
          setServerPort(12680)
        }
      } catch {
        // 尝试 fallback 端口
        try {
          const response = await fetch('http://127.0.0.1:12681/skill/autopilot')
          if (response.ok) {
            const data = await response.json()
            setAutopilotEnabled(data.enabled)
            setServerPort(12681)
          }
        } catch {
          // 无法连接到 Skill Server
        }
      }
    })()
  }, [])

  // 自动滚动日志
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  // 切换自动驾驶状态
  const toggleAutopilot = useCallback(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}/skill/autopilot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !autopilotEnabled })
      })
      if (response.ok) {
        const data = await response.json()
        setAutopilotEnabled(data.enabled)
        showToast(data.enabled ? '自动驾驶已启用' : '自动驾驶已禁用', 'success')
      }
    } catch (e) {
      showToast('切换失败', 'error')
    }
  }, [autopilotEnabled, serverPort])

  return (
    <div className="fade-in">
      {/* Alert Banner */}
      {currentAlert && (
        <div className={`alert-banner ${currentAlert.severity}`}>
          <span>{currentAlert.message}</span>
          <button className="close-btn" onClick={() => setCurrentAlert(null)}>×</button>
        </div>
      )}

      {/* 自动驾驶开关 */}
      <div className="card autopilot-card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="card-title">自动驾驶</div>
            <div className="autopilot-desc" style={{ fontSize: '12px', color: '#8a8aa0', marginTop: '4px' }}>
              {autopilotEnabled ? '自动回复消息中' : '暂停自动回复，手动回复模式'}
            </div>
          </div>
          <button
            className={`autopilot-toggle ${autopilotEnabled ? 'enabled' : 'disabled'}`}
            onClick={toggleAutopilot}
            style={{
              width: '56px',
              height: '28px',
              borderRadius: '14px',
              border: 'none',
              background: autopilotEnabled ? '#10b981' : '#3a3a50',
              cursor: 'pointer',
              position: 'relative',
              transition: 'background 250ms'
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: '3px',
                left: autopilotEnabled ? '30px' : '3px',
                width: '22px',
                height: '22px',
                borderRadius: '11px',
                background: '#fff',
                transition: 'left 250ms'
              }}
            />
          </button>
        </div>
      </div>

      {/* 组件状态面板 */}
      <ComponentStatus serverPort={serverPort} />

      {/* 消息日志 */}
      <div className="card">
        <div className="card-title">消息日志</div>
        <div className="message-log" ref={logRef}>
          {logs.length === 0 ? (
            <div className="message-log-empty">等待消息...</div>
          ) : (
            logs.map((entry, i) => (
              <div className="log-entry" key={i}>
                <span className="log-time">{entry.time}</span>
                <span className={`log-type ${entry.type}`}>
                  {entry.type === 'receive' ? '收到' :
                   entry.type === 'reply' ? '回复' :
                   entry.type === 'skip' ? '跳过' :
                   entry.type === 'error' ? '错误' :
                   entry.type === 'info' ? '信息' :
                   entry.type === 'monitor' ? '监控' :
                   entry.type === 'heartbeat' ? '心跳' : '思考'}
                </span>
                {entry.contact && <span style={{ color: '#a0a0b8', marginRight: '4px' }}>{entry.contact}:</span>}
                <span>{entry.content}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 首次启动引导 */}
      {showOnboarding && (
        <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
      )}
    </div>
  )
}

type GlueLayerStatus = 'stopped' | 'starting' | 'running' | 'crashed' | 'failed'

function ComponentStatus({ serverPort }: { serverPort: number }): React.JSX.Element {
  const [glueStatus, setGlueStatus] = useState<GlueLayerStatus>('stopped')
  const [sightflowOk, setSightflowOk] = useState(false)
  const [restarting, setRestarting] = useState(false)

  // 初始获取状态
  useEffect(() => {
    void (async () => {
      try {
        const status = await window.electron?.wechatAgent?.getGlueLayerStatus()
        if (status) setGlueStatus(status as GlueLayerStatus)
      } catch { /* ignore */ }

      // 检测 SightFlow 服务
      try {
        const r = await fetch(`http://127.0.0.1:${serverPort}/skill/status`)
        setSightflowOk(r.ok)
      } catch {
        setSightflowOk(false)
      }
    })()
  }, [serverPort])

  // 监听 glue-layer 状态变化
  useEffect(() => {
    const cleanup = window.electron?.on('wechat-agent:glue-layer-status', (status: string) => {
      setGlueStatus(status as GlueLayerStatus)
    })
    return cleanup
  }, [])

  const handleRestart = useCallback(async () => {
    setRestarting(true)
    try {
      await window.electron?.wechatAgent?.restartGlueLayer()
    } catch { /* ignore */ }
    setTimeout(() => setRestarting(false), 2000)
  }, [])

  const statusLabel = (s: GlueLayerStatus): string => {
    const map: Record<GlueLayerStatus, string> = {
      running: '运行中',
      starting: '启动中',
      stopped: '已停止',
      crashed: '已崩溃',
      failed: '启动失败'
    }
    return map[s] || s
  }

  const statusDotClass = (s: GlueLayerStatus): string => {
    if (s === 'running') return 'status-dot-running'
    if (s === 'starting') return 'status-dot-waiting'
    return 'status-dot-error'
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-title">组件状态</div>
      <div className="component-status-list">
        {/* SightFlow 发送服务 */}
        <div className="component-status-row">
          <span className={sightflowOk ? 'status-dot-running' : 'status-dot-error'} />
          <span className="component-status-name">SightFlow 发送服务</span>
          <span className="component-status-label">
            {sightflowOk ? '运行中' : '未连接'}
          </span>
        </div>

        {/* 粘合层 */}
        <div className="component-status-row">
          <span className={statusDotClass(glueStatus)} />
          <span className="component-status-name">粘合层</span>
          <span className="component-status-label">{statusLabel(glueStatus)}</span>
          <button
            className="component-status-action"
            onClick={handleRestart}
            disabled={restarting}
            title="重启粘合层"
          >
            {restarting ? '…' : '↻'}
          </button>
        </div>
      </div>
    </div>
  )
}

function BottomBar() {
  const [glueLayerConnected, setGlueLayerConnected] = useState(false)
  const listenerAttached = useRef(false)

  // 监听粘合层日志来判断连接状态（防止 HMR 导致重复注册）
  useEffect(() => {
    if (listenerAttached.current) return
    listenerAttached.current = true

    const cleanup = window.electron?.on('glue-layer:log', () => {
      setGlueLayerConnected(true)
    })
    return cleanup
  }, [])

  return (
    <div className="bottom-bar">
      {/* 左侧：发送服务状态 */}
      <div className="bottom-status-left">
        <span className="status-dot-running" />
        <span className="status-label">发送服务运行中</span>
      </div>

      {/* 中间：设置按钮 */}
      <button
        className="bottom-btn-settings"
        onClick={() => window.electron?.invoke('settings:open')}
        title="设置"
      >
        <GearIcon />
      </button>

      {/* 右侧：粘合层状态 */}
      <div className="bottom-status-right">
        <span className={`status-dot-${glueLayerConnected ? 'connected' : 'waiting'}`} />
        <span className={`status-label-${glueLayerConnected ? 'connected' : 'waiting'}`}>
          {glueLayerConnected ? '粘合层已连接' : '等待连接...'}
        </span>
      </div>
    </div>
  )
}

function SettingsWindow(): React.JSX.Element {
  const [section, setSection] = useState<SettingsSection>('base')

  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-brand">
          <img src={logoUrl} alt="WeChat-Driverless" className="app-logo" />
          <span>设置</span>
        </div>
        <button
          className={`settings-nav-item ${section === 'base' ? 'active' : ''}`}
          onClick={() => setSection('base')}
        >
          基础配置
        </button>
        {/* 智能体 tab 已隐藏 - 微信 Agent 使用统一 Provider 系统，不需要单独配置 */}
        {/* <button
          className={`settings-nav-item ${section === 'agent' ? 'active' : ''}`}
          onClick={() => setSection('agent')}
        >
          智能体
        </button> */}
        <button
          className={`settings-nav-item ${section === 'wechat-agent' ? 'active' : ''}`}
          onClick={() => setSection('wechat-agent')}
        >
          微信 Agent
        </button>
        <button
          className={`settings-nav-item ${section === 'logs' ? 'active' : ''}`}
          onClick={() => setSection('logs')}
        >
          日志
        </button>
      </aside>

      <main className="settings-main">
        {section === 'base' ? (
          <SettingsPanel />
        ) : section === 'agent' ? (
          <AgentPanel />
        ) : section === 'logs' ? (
          <LogViewer />
        ) : (
          <WechatAgentSettings />
        )}
      </main>
    </div>
  )
}

function SettingsPanel() {
  const [visionApiKey, setVisionApiKey] = useState('')
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    const load = async () => {
      const settings = (await window.electron?.invoke('settings:getAll')) as AppSettings | undefined
      if (settings) {
        setVisionApiKey(settings.vision?.apiKey || '')
      }
    }

    void load()
  }, [])

  const handleSaveVision = useCallback(async () => {
    const payload: Partial<AppSettings> = {
      vision: { apiKey: visionApiKey }
    }
    await window.electron?.invoke('settings:set', payload)
    await window.electron?.invoke('engine:updateConfig', {
      ...((await window.electron?.invoke('settings:getAll')) as AppSettings),
      ...payload,
      vision: { apiKey: visionApiKey }
    })
    showToast(t('settings.saved'), 'success')
  }, [visionApiKey])

  const handleTestConnection = useCallback(async () => {
    if (!visionApiKey) return
    setTesting(true)
    try {
      const result = await window.electron?.invoke('engine:testConnection', {
        apiKey: visionApiKey
      })
      if (result?.success) {
        showToast(t('settings.testConnection.success'), 'success')
      } else {
        showToast(`${t('settings.testConnection.fail')}: ${result?.error || ''}`, 'error')
      }
    } catch (e: any) {
      showToast(`${t('settings.testConnection.fail')}: ${e.message}`, 'error')
    } finally {
      setTesting(false)
    }
  }, [visionApiKey])

  return (
    <div className="settings-page slide-up">
      <div className="settings-page-header">
        <div>
          <h1>基础配置</h1>
          <p>维护桌面端运行所需的基础参数。</p>
        </div>
      </div>

      <div className="card base-settings-card">
        <div className="card-title">{t('settings.vision')}</div>

        <div className="form-group">
          <label className="form-label">{t('settings.visionApiKey')}</label>
          <input
            className="form-input"
            type="password"
            value={visionApiKey}
            onChange={(e) => setVisionApiKey(e.target.value)}
            placeholder={t('settings.visionApiKey.placeholder')}
            autoComplete="off"
          />
          <div className="form-hint">{t('settings.visionApiKey.hint')}</div>
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.visionModel')}</label>
          <input className="form-input" value="doubao-seed-2.0-lite" disabled />
        </div>

        <div className="form-group">
          <label className="form-label">{t('settings.visionBaseUrl')}</label>
          <input className="form-input" value="https://ark.cn-beijing.volces.com/api/plan/v3" disabled />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={handleTestConnection}
            disabled={!visionApiKey || testing}
          >
            {testing ? t('settings.testConnection.testing') : t('settings.testConnection')}
          </button>
          <button className="btn btn-primary" onClick={handleSaveVision} style={{ flex: 1 }}>
            {t('settings.saveVision')}
          </button>
        </div>
      </div>
    </div>
  )
}

function AgentPanel(): React.JSX.Element {
  const [catalog, setCatalog] = useState<ProviderCatalogItem[]>(BUILTIN_PROVIDER_CATALOG)
  const [selectedId, setSelectedId] = useState(BUILTIN_PROVIDER_CATALOG[0]?.id || '')
  const [activeId, setActiveId] = useState('doubao')
  const [providerDrafts, setProviderDrafts] = useState<Record<string, Record<string, string>>>({})
  const [currentSettings, setCurrentSettings] = useState<AppSettings | null>(null)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [updatingCatalog, setUpdatingCatalog] = useState(false)
  const selectedProvider = catalog.find((provider) => provider.id === selectedId) || catalog[0]

  const loadSettingsAndCatalog = useCallback(async (forceUpdate: boolean) => {
    setLoadingCatalog(!forceUpdate)
    setUpdatingCatalog(forceUpdate)
    try {
      const [settings, result] = await Promise.all([
        window.electron?.invoke('settings:getAll') as Promise<AppSettings | undefined>,
        window.electron?.invoke(forceUpdate ? 'providerHub:update' : 'providerHub:getCatalog') as Promise<ProviderHubResult>
      ])

      const nextCatalog = mergeProviderCatalog(result?.catalog?.providers || [])
      const nextActiveId = settings?.chatProvider?.installed?.id || 'doubao'
      setCatalog(nextCatalog)
      setCurrentSettings(settings || null)
      setActiveId(nextActiveId)
      setSelectedId((current) => current || nextActiveId || BUILTIN_PROVIDER_CATALOG[0]?.id || nextCatalog[0]?.id || '')
      setProviderDrafts((prev) => ({
        ...prev,
        doubao: {
          ...getProviderDefaults(BUILTIN_PROVIDER_CATALOG[0]),
          ...(prev.doubao || {}),
          ...(!settings?.chatProvider?.installed ? settings?.chatProvider?.config || {} : {}),
          apiKey: prev.doubao?.apiKey || settings?.vision?.apiKey || ''
        },
        [nextActiveId]: {
          ...getProviderDefaults(nextCatalog.find((provider) => provider.id === nextActiveId)),
          ...(prev[nextActiveId] || {}),
          ...(settings?.chatProvider?.config || {})
        }
      }))

      if (result && !result.success) {
        showToast(`智能体列表加载失败: ${result.error || ''}`, 'error')
      } else if (forceUpdate) {
        showToast('智能体列表已更新', 'success')
      }
    } finally {
      setLoadingCatalog(false)
      setUpdatingCatalog(false)
    }
  }, [])

  useEffect(() => {
    void loadSettingsAndCatalog(false)
  }, [loadSettingsAndCatalog])

  const selectedValues = useMemo(
    () => getProviderValues(providerDrafts, selectedProvider, currentSettings),
    [currentSettings, providerDrafts, selectedProvider]
  )

  const setProviderValue = useCallback(
    (fieldKey: string, value: string) => {
      if (!selectedProvider) return
      setProviderDrafts((prev) => ({
        ...prev,
        [selectedProvider.id]: {
          ...getProviderValues(prev, selectedProvider, currentSettings),
          [fieldKey]: value
        }
      }))
    },
    [currentSettings, selectedProvider]
  )

  const persistProvider = useCallback(
    async (provider: ProviderCatalogItem, values: Record<string, string>) => {
      const missing = getMissingRequiredFields(provider, values)
      if (missing.length > 0) {
        showToast(`缺少必填项: ${missing.join('、')}`, 'error')
        return false
      }

      if (provider.id === 'doubao') {
        const { apiKey, ...providerConfig } = values
        await window.electron?.invoke('settings:set', {
          vision: { apiKey },
          chatProvider: {
            manifestUrl: '',
            installed: null,
            config: providerConfig
          }
        })
        const settings = (await window.electron?.invoke('settings:getAll')) as AppSettings
        await window.electron?.invoke('engine:updateConfig', settings)
        setCurrentSettings(settings)
        setActiveId('doubao')
        return true
      }

      const installResult = await window.electron?.invoke('provider:installFromUrl', provider.manifestUrl)
      if (!installResult?.success) {
        showToast(installResult?.error || '智能体安装失败', 'error')
        return false
      }

      await window.electron?.invoke('settings:set', {
        chatProvider: {
          manifestUrl: provider.manifestUrl,
          installed: installResult.installed,
          config: values
        }
      })
      const settings = (await window.electron?.invoke('settings:getAll')) as AppSettings
      await window.electron?.invoke('engine:updateConfig', settings)
      setCurrentSettings(settings)
      setActiveId(provider.id)
      return true
    },
    []
  )

  const handleSaveConfig = useCallback(async () => {
    if (!selectedProvider) return
    const ok = await persistProvider(selectedProvider, selectedValues)
    if (ok) showToast('智能体配置已保存', 'success')
  }, [persistProvider, selectedProvider, selectedValues])

  const handleActivate = useCallback(async () => {
    if (!selectedProvider) return
    const ok = await persistProvider(selectedProvider, selectedValues)
    if (ok) showToast('已切换当前智能体', 'success')
  }, [persistProvider, selectedProvider, selectedValues])

  return (
    <div className="settings-page slide-up">
      <div className="settings-page-header">
        <div>
          <div className="settings-title-row">
            <h1>智能体</h1>
            <button
              className="icon-action refresh-action"
              onClick={() => loadSettingsAndCatalog(true)}
              disabled={updatingCatalog}
              title={updatingCatalog ? '更新中...' : '更新列表'}
              aria-label={updatingCatalog ? '更新中' : '更新智能体列表'}
            >
              <span className={updatingCatalog ? 'refresh-icon spinning' : 'refresh-icon'}>
                <RefreshIcon />
              </span>
            </button>
            {updatingCatalog ? <span className="inline-status">更新中...</span> : null}
          </div>
          <p>选择负责聊天分析和内容生成的智能体，并维护各自配置。</p>
        </div>
      </div>

      {loadingCatalog ? (
        <div className="provider-hub-meta">
          <span className="spinner" />
          正在加载远端智能体列表
        </div>
      ) : null}

      <div className="provider-layout">
        <div className="provider-list">
          {!loadingCatalog && catalog.length === 0 ? (
            <div className="provider-empty">暂无可用智能体，请点击更新列表。</div>
          ) : null}
          {catalog.map((provider) => {
            const description = provider.description || provider.name
            const active = activeId === provider.id

            return (
              <button
                key={provider.id}
                className={`provider-card ${selectedId === provider.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(provider.id)}
              >
                <div className="provider-card-top">
                  <span className="provider-name">{provider.name}</span>
                  {active ? (
                    <span className="provider-status" title="当前启用" aria-label="当前启用">
                      <span className="provider-status-dot" />
                      启用中
                    </span>
                  ) : null}
                </div>
                <div className="provider-desc" title={description}>
                  {description}
                </div>
                <div className="provider-version">v{provider.version}</div>
              </button>
            )
          })}
        </div>

        <div className="card provider-config-card">
          {selectedProvider ? (
            <>
              <div className="provider-config-header">
                <div>
                  <div className="card-title">智能体配置</div>
                  <h2>{selectedProvider.name}</h2>
                </div>
                <span className="provider-version">v{selectedProvider.version}</span>
              </div>

              {selectedProvider.configSchema.fields.map((field) => (
                <ProviderFieldInput
                  key={field.key}
                  field={field}
                  value={selectedValues[field.key] || ''}
                  onChange={(value) => setProviderValue(field.key, value)}
                />
              ))}

              <div className="provider-actions">
                <button className="btn btn-secondary" onClick={handleSaveConfig}>
                  保存配置
                </button>
                <button className="btn btn-primary" onClick={handleActivate}>
                  启用此智能体
                </button>
              </div>
            </>
          ) : (
            <div className="provider-empty">没有选中的智能体。</div>
          )}
        </div>
      </div>
    </div>
  )
}

function ProviderFieldInput({
  field,
  value,
  onChange
}: {
  field: ProviderConfigField
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div className="form-group">
      <label className="form-label">
        {field.label}
        {field.required ? <span className="required-mark"> *</span> : null}
      </label>
      {field.type === 'textarea' ? (
        <textarea
          className="form-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          rows={4}
          readOnly={field.readonly}
        />
      ) : field.type === 'select' ? (
        <select
          className="form-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={field.readonly}
        >
          {(field.options || []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="form-input"
          type={field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          autoComplete="off"
          readOnly={field.readonly}
        />
      )}
      {field.hint ? <div className="form-hint">{field.hint}</div> : null}
    </div>
  )
}

function mergeProviderCatalog(remoteProviders: ProviderCatalogItem[]): ProviderCatalogItem[] {
  const remoteOnly = remoteProviders.filter(
    (provider) => !BUILTIN_PROVIDER_CATALOG.some((builtin) => builtin.id === provider.id)
  )
  return [...BUILTIN_PROVIDER_CATALOG, ...remoteOnly]
}

function getProviderDefaults(provider: ProviderCatalogItem | undefined): Record<string, string> {
  if (!provider) return {}
  return provider.configSchema.fields.reduce<Record<string, string>>((acc, field) => {
    acc[field.key] = field.defaultValue || ''
    return acc
  }, {})
}

function getProviderValues(
  drafts: Record<string, Record<string, string>>,
  provider: ProviderCatalogItem | undefined,
  settings: AppSettings | null
): Record<string, string> {
  if (!provider) return {}
  const defaults = getProviderDefaults(provider)
  if (provider.id === 'doubao') {
    return {
      ...defaults,
      ...(settings?.chatProvider.installed ? {} : settings?.chatProvider.config || {}),
      apiKey: drafts.doubao?.apiKey || settings?.vision.apiKey || '',
      ...(drafts.doubao || {})
    }
  }
  return {
    ...defaults,
    ...(settings?.chatProvider.installed?.id === provider.id ? settings.chatProvider.config : {}),
    ...(drafts[provider.id] || {})
  }
}

function getMissingRequiredFields(
  provider: ProviderCatalogItem,
  values: Record<string, string>
): string[] {
  return provider.configSchema.fields
    .filter((field) => field.required && !values[field.key]?.trim())
    .map((field) => field.label)
}

let _showToast: ((msg: string, type: 'success' | 'error') => void) | null = null

function showToast(msg: string, type: 'success' | 'error') {
  _showToast?.(msg, type)
}

function Toast() {
  const [visible, setVisible] = useState(false)
  const [message, setMessage] = useState('')
  const [type, setType] = useState<'success' | 'error'>('success')
  const timerRef = useRef<number | undefined>(undefined)

  _showToast = useCallback((msg: string, t: 'success' | 'error') => {
    setMessage(msg)
    setType(t)
    setVisible(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setVisible(false), 2500)
  }, [])

  return <div className={`toast ${type} ${visible ? 'show' : ''}`}>{message}</div>
}

export default App

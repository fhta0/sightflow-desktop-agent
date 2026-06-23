// sightflow-desktop-agent/src/renderer/src/WechatAgentSettings.tsx
import { useState, useEffect } from 'react'
import { AlertData } from './types'

interface WechatAgentConfig {
  version: number
  identity: { wxid: string; names: string[] }
  groups: { monitor: Array<{ room_id: string; name: string }> }
  ai: { api_url: string; api_key: string; api_key_format: string; model: string }
  advanced: { wx_cli_path: string }
  _decryptFailed?: boolean
}

interface GroupOption {
  room_id: string
  name: string
}

export function WechatAgentSettings(): React.JSX.Element {
  const [config, setConfig] = useState<WechatAgentConfig>({
    version: 1,
    identity: { wxid: '', names: [] },
    groups: { monitor: [] },
    ai: { api_url: '', api_key: '', api_key_format: 'dpapi', model: 'gpt-4o-mini' },
    advanced: { wx_cli_path: 'wx' }
  })
  const [availableGroups, setAvailableGroups] = useState<GroupOption[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [currentAlert, setCurrentAlert] = useState<AlertData | null>(null)

  const loadConfig = async (): Promise<WechatAgentConfig | null> => {
    const loaded = await window.electron?.invoke('wechat-agent:loadConfig')
    if (loaded) {
      const loadedConfig = loaded as WechatAgentConfig
      // 检测解密失败标志
      if (loadedConfig._decryptFailed) {
        setCurrentAlert({
          severity: 'warning',
          code: 'api_key_decrypt_failed',
          message: 'API Key 解密失败，请重新输入',
          timestamp: Date.now()
        })
        // 清空无法解密的 key，让用户重新输入
        loadedConfig.ai.api_key = ''
      }
      setConfig(loadedConfig)
      return loadedConfig
    }
    return null
  }

  const loadGroups = async (wxCliPath: string): Promise<void> => {
    const result = await window.electron?.invoke('wechat-agent:getGroups', wxCliPath)
    if (result?.ok) {
      setAvailableGroups(result.groups || [])
    }
  }

  useEffect(() => {
    // 先加载配置，再用配置中的 wx_cli_path 加载群组
    loadConfig().then((loadedConfig) => {
      // 即使没有配置文件，也使用默认路径加载群组
      const wxCliPath = loadedConfig?.advanced.wx_cli_path || 'wx'
      void loadGroups(wxCliPath)
    })

    // 监听告警事件（设置窗口也需要，因为和主窗口是独立的 BrowserWindow）
    const unsubAlert = window.electron?.on('wechat-agent:alert-pushed', (alert: AlertData) => {
      setCurrentAlert(alert)
    })
    return () => { unsubAlert?.() }
  }, [])

  const handleSave = async () => {
    // 客户端校验
    if (!config.identity.wxid.trim()) {
      alert('请填写微信 ID')
      return
    }
    if (config.groups.monitor.length === 0) {
      alert('请至少选择一个监控群组')
      return
    }
    if (!config.ai.api_url.trim()) {
      alert('请填写 AI API URL')
      return
    }
    if (!config.ai.api_key.trim()) {
      alert('请填写 AI API Key')
      return
    }

    setSaving(true)
    const result = await window.electron?.invoke('wechat-agent:saveConfig', config)
    setSaving(false)
    if (result?.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } else {
      alert(`保存失败: ${result?.error || '未知错误'}`)
    }
  }

  const handleDetectWxid = async () => {
    const result = await window.electron?.invoke('wechat-agent:detectWxid', config.advanced.wx_cli_path)
    if (result?.ok && result.wxid) {
      setConfig(prev => ({ ...prev, identity: { ...prev.identity, wxid: result.wxid } }))
    } else if (!result?.ok) {
      alert('自动检测失败，请确认 wx-cli 已升级到支持 whoami 的版本')
    } else if (!result.wxid) {
      alert('未能检测到 wxid，请手动输入')
    }
  }

  const handleOpenConfigDir = async () => {
    await window.electron?.invoke('wechat-agent:openConfigDir')
  }

  // 群监控切换
  const toggleGroup = (group: GroupOption) => {
    setConfig(prev => {
      const monitored = prev.groups.monitor
      const exists = monitored.some(g => g.room_id === group.room_id)
      if (exists) {
        return { ...prev, groups: { monitor: monitored.filter(g => g.room_id !== group.room_id) } }
      } else {
        return { ...prev, groups: { monitor: [...monitored, group] } }
      }
    })
  }

  const isGroupMonitored = (roomId: string) => {
    return config.groups.monitor.some(g => g.room_id === roomId)
  }

  return (
    <div className="settings-page slide-up">
      {/* Alert Banner */}
      {currentAlert && (
        <div className={`alert-banner ${currentAlert.severity}`}>
          <span>{currentAlert.message}</span>
          <button className="close-btn" onClick={() => setCurrentAlert(null)}>×</button>
        </div>
      )}

      <div className="settings-page-header">
        <div>
          <h1>微信 Agent</h1>
          <p>配置微信自动回复 Agent 的身份、监控群组和 AI 服务。</p>
        </div>
      </div>

      {/* 身份配置 */}
      <div className="card">
        <div className="card-title">身份配置</div>
        <div className="form-group">
          <label className="form-label">微信 ID</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              className="form-input"
              value={config.identity.wxid}
              onChange={(e) => setConfig(prev => ({ ...prev, identity: { ...prev.identity, wxid: e.target.value } }))}
              placeholder="wxid_xxxxxxxx"
            />
            <button className="btn btn-secondary" onClick={handleDetectWxid}>
              自动检测
            </button>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">群昵称（输入后按回车添加）</label>
          <TagInput
            tags={config.identity.names}
            onChange={(names) => setConfig(prev => ({ ...prev, identity: { ...prev.identity, names } }))}
          />
          <p className="form-hint">用于识别自己的消息和检测群聊中的 @</p>
        </div>
      </div>

      {/* 监控群组 */}
      <div className="card">
        <div className="card-title">监控群组</div>
        <div className="form-group">
          <p className="form-hint">勾选要开启自动回复的群</p>
          {availableGroups.length === 0 ? (
            <p className="form-hint">未找到群组，请确认 wx-cli daemon 已启动</p>
          ) : (
            <div className="group-list">
              {availableGroups.map(group => (
                <label key={group.room_id} className="group-list-item">
                  <input
                    type="checkbox"
                    checked={isGroupMonitored(group.room_id)}
                    onChange={() => toggleGroup(group)}
                  />
                  <span>{group.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* AI 服务 */}
      <div className="card">
        <div className="card-title">AI 服务</div>
        <div className="form-group">
          <label className="form-label">API URL</label>
          <input
            className="form-input"
            value={config.ai.api_url}
            onChange={(e) => setConfig(prev => ({ ...prev, ai: { ...prev.ai, api_url: e.target.value } }))}
            placeholder="https://api.openai.com/v1"
          />
        </div>
        <div className="form-group">
          <label className="form-label">API Key</label>
          <input
            className="form-input"
            type="password"
            value={config.ai.api_key}
            onChange={(e) => setConfig(prev => ({ ...prev, ai: { ...prev.ai, api_key: e.target.value } }))}
            placeholder="sk-..."
          />
        </div>
        <div className="form-group">
          <label className="form-label">Model</label>
          <input
            className="form-input"
            value={config.ai.model}
            onChange={(e) => setConfig(prev => ({ ...prev, ai: { ...prev.ai, model: e.target.value } }))}
            placeholder="gpt-4o-mini"
          />
        </div>
      </div>

      {/* 高级设置 */}
      <details className="card">
        <summary className="card-title" style={{ cursor: 'pointer' }}>高级设置</summary>
        <div className="form-group">
          <label className="form-label">wx-cli 路径</label>
          <input
            className="form-input"
            value={config.advanced.wx_cli_path}
            onChange={(e) => setConfig(prev => ({ ...prev, advanced: { ...prev.advanced, wx_cli_path: e.target.value } }))}
            placeholder="wx"
          />
          <p className="form-hint">默认自动检测 PATH，如未生效可手动指定完整路径</p>
        </div>
        <button className="btn btn-secondary" onClick={handleOpenConfigDir}>
          打开配置文件夹
        </button>
      </details>

      {/* 保存按钮 */}
      <div style={{ textAlign: 'center', marginTop: '24px' }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : saved ? '已保存 ✓' : '保存配置'}
        </button>
      </div>
    </div>
  )
}

// TagInput 组件
function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState('')

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault()
      if (!tags.includes(input.trim())) {
        onChange([...tags, input.trim()])
        setInput('')  // 成功添加才清空
      }
      // 重复时保留 input，让用户看到没被添加并自行修改
    }
  }

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index))
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
        {tags.map((tag, i) => (
          <span key={i} className="tag">
            {tag}
            <button onClick={() => removeTag(i)} style={{ marginLeft: '4px', cursor: 'pointer', background: 'none', border: 'none', color: 'inherit' }}>×</button>
          </span>
        ))}
      </div>
      <input
        className="form-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入昵称，按回车添加"
      />
    </div>
  )
}

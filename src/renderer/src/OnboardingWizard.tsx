// sightflow-desktop-agent/src/renderer/src/OnboardingWizard.tsx
import { useState, useEffect, useCallback } from 'react'

interface OnboardingWizardProps {
  onComplete: () => void
}

interface WeChatInstallStatus {
  installed: boolean
  version: string | null
  installPath: string | null
  needsInstall: boolean
}

type WizardStep = 'welcome' | 'wechat' | 'identity' | 'done'

export function OnboardingWizard({ onComplete }: OnboardingWizardProps): React.JSX.Element {
  const [step, setStep] = useState<WizardStep>('welcome')
  const [wechatStatus, setWechatStatus] = useState<WeChatInstallStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [wxid, setWxid] = useState('')
  const [names, setNames] = useState<string[]>([])
  const [nameInput, setNameInput] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [saving, setSaving] = useState(false)

  // Step 2: 检测微信
  const checkWeChat = useCallback(async () => {
    setChecking(true)
    try {
      const status = await window.electron?.wechatAgent?.checkWeChat()
      setWechatStatus(status || { installed: false, version: null, installPath: null, needsInstall: true })
    } catch {
      setWechatStatus({ installed: false, version: null, installPath: null, needsInstall: true })
    }
    setChecking(false)
  }, [])

  const handleInstallWeChat = useCallback(async () => {
    setInstalling(true)
    try {
      const result = await window.electron?.wechatAgent?.installWeChat()
      if (result?.ok) {
        // 重新检测
        await checkWeChat()
      }
    } catch { /* ignore */ }
    setInstalling(false)
  }, [checkWeChat])

  // Step 3: 检测 wxid
  const handleDetectWxid = useCallback(async () => {
    setDetecting(true)
    try {
      const result = await window.electron?.invoke('wechat-agent:detectWxid', 'wx')
      if (result?.ok && result.wxid) {
        setWxid(result.wxid)
      }
    } catch { /* ignore */ }
    setDetecting(false)
  }, [])

  // Step 3: 添加昵称
  const handleAddName = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && nameInput.trim()) {
      e.preventDefault()
      if (!names.includes(nameInput.trim())) {
        setNames([...names, nameInput.trim()])
      }
      setNameInput('')
    }
  }

  // Step 4: 保存配置
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const config = {
        version: 1,
        identity: { wxid, names },
        groups: { monitor: [] },
        advanced: { wx_cli_path: 'wx' }
      }
      await window.electron?.invoke('wechat-agent:saveConfig', config)
    } catch { /* ignore */ }
    setSaving(false)
    setStep('done')
  }, [wxid, names])

  // 进入微信检测步骤时自动检测
  useEffect(() => {
    if (step === 'wechat') {
      void checkWeChat()
    }
  }, [step, checkWeChat])

  const renderStep = () => {
    switch (step) {
      case 'welcome':
        return (
          <div className="onboarding-step">
            <div className="onboarding-icon">🤖</div>
            <h2>欢迎使用微信自动回复</h2>
            <p className="onboarding-desc">只需 3 步即可完成设置，让 AI 帮你自动回复微信消息。</p>
            <div className="onboarding-steps-preview">
              <div className="onboarding-step-item">
                <span className="onboarding-step-num">1</span>
                <span>检测微信安装</span>
              </div>
              <div className="onboarding-step-item">
                <span className="onboarding-step-num">2</span>
                <span>配置身份信息</span>
              </div>
              <div className="onboarding-step-item">
                <span className="onboarding-step-num">3</span>
                <span>开始使用</span>
              </div>
            </div>
            <button className="btn btn-primary onboarding-next" onClick={() => setStep('wechat')}>
              开始设置
            </button>
          </div>
        )

      case 'wechat':
        return (
          <div className="onboarding-step">
            <div className="onboarding-icon">💬</div>
            <h2>检测微信</h2>
            {checking ? (
              <p className="onboarding-desc">正在检测...</p>
            ) : wechatStatus?.installed ? (
              <div className="onboarding-result success">
                <span className="onboarding-check">✓</span>
                <div>
                  <p>微信已安装</p>
                  {wechatStatus.version && (
                    <p className="onboarding-detail">版本: {wechatStatus.version}</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="onboarding-result">
                <p className="onboarding-desc">未检测到微信，需要先安装。</p>
                <button
                  className="btn btn-primary"
                  onClick={handleInstallWeChat}
                  disabled={installing}
                >
                  {installing ? '安装中...' : '安装微信'}
                </button>
              </div>
            )}
            <div className="onboarding-actions">
              <button className="btn btn-secondary" onClick={() => setStep('welcome')}>
                上一步
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setStep('identity')}
                disabled={checking}
              >
                下一步
              </button>
            </div>
          </div>
        )

      case 'identity':
        return (
          <div className="onboarding-step">
            <div className="onboarding-icon">👤</div>
            <h2>配置身份</h2>
            <p className="onboarding-desc">设置你的微信 ID 和昵称，用于识别消息。</p>

            <div className="form-group">
              <label className="form-label">微信 ID</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  className="form-input"
                  value={wxid}
                  onChange={(e) => setWxid(e.target.value)}
                  placeholder="wxid_xxxxxxxx"
                />
                <button
                  className="btn btn-secondary"
                  onClick={handleDetectWxid}
                  disabled={detecting}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {detecting ? '检测中...' : '自动检测'}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">群聊昵称（可选）</label>
              <div className="onboarding-tags">
                {names.map((tag, i) => (
                  <span key={i} className="tag">
                    {tag}
                    <button onClick={() => setNames(names.filter((_, j) => j !== i))}>×</button>
                  </span>
                ))}
              </div>
              <input
                className="form-input"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={handleAddName}
                placeholder="输入昵称，按回车添加（用于识别群聊中的 @）"
              />
            </div>

            <div className="onboarding-actions">
              <button className="btn btn-secondary" onClick={() => setStep('wechat')}>
                上一步
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={!wxid.trim() || saving}
              >
                {saving ? '保存中...' : '保存并开始'}
              </button>
            </div>
          </div>
        )

      case 'done':
        return (
          <div className="onboarding-step">
            <div className="onboarding-icon">🎉</div>
            <h2>设置完成！</h2>
            <p className="onboarding-desc">一切就绪，可以开始使用了。</p>
            <button className="btn btn-primary onboarding-next" onClick={onComplete}>
              开始使用
            </button>
          </div>
        )
    }
  }

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        {renderStep()}
      </div>
    </div>
  )
}

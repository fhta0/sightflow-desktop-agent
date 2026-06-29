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
  running: boolean
  downloadUrl: string
}

type WizardStep = 'welcome' | 'wechat' | 'identity' | 'init' | 'done'

export function OnboardingWizard({ onComplete }: OnboardingWizardProps): React.JSX.Element {
  const [step, setStep] = useState<WizardStep>('welcome')
  const [wechatStatus, setWechatStatus] = useState<WeChatInstallStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [wxid, setWxid] = useState('')
  const [names, setNames] = useState<string[]>([])
  const [nameInput, setNameInput] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [initResult, setInitResult] = useState<{ ok: boolean; message?: string } | null>(null)

  // Step 2: 检测微信
  const checkWeChat = useCallback(async () => {
    setChecking(true)
    try {
      const status = await window.electron?.wechatAgent?.checkWeChat()
      setWechatStatus(status || {
        installed: false,
        version: null,
        installPath: null,
        needsInstall: true,
        running: false,
        downloadUrl: 'https://dldir1.qq.com/weixin/Windows/WeChatWin.exe'
      })
    } catch {
      setWechatStatus({
        installed: false,
        version: null,
        installPath: null,
        needsInstall: true,
        running: false,
        downloadUrl: 'https://dldir1.qq.com/weixin/Windows/WeChatWin.exe'
      })
    }
    setChecking(false)
  }, [])

  const handleOpenDownload = useCallback(async () => {
    await window.electron?.wechatAgent?.openWeChatDownload()
  }, [])

  // Step 3: 检测 wxid
  const handleDetectWxid = useCallback(async () => {
    setDetecting(true)
    try {
      // 使用打包的 wx-cli 路径
      const bundledPath = await window.electron?.invoke('wechat-agent:getBundledWxPath')
      const result = await window.electron?.invoke('wechat-agent:detectWxid', bundledPath || 'wx')
      if (result?.ok && result.wxid) {
        setWxid(result.wxid)
      } else if (!result?.ok) {
        alert(`自动检测失败: ${result?.error || '未知错误'}`)
      } else if (!result.wxid) {
        alert('未能检测到 wxid，请手动输入')
      }
    } catch (e: any) {
      alert(`自动检测异常: ${e?.message || e}`)
    }
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
      // 使用打包的 wx-cli 路径而非 'wx'（客户机器上 wx 不在 PATH 中）
      const bundledWxPath = await window.electron?.invoke('wechat-agent:getBundledWxPath')
      const config = {
        version: 1,
        identity: { wxid, names },
        groups: { monitor: [] },
        advanced: { wx_cli_path: bundledWxPath || 'wx' }
      }
      await window.electron?.invoke('wechat-agent:saveConfig', config)
    } catch { /* ignore */ }
    setSaving(false)
    setStep('init')
  }, [wxid, names])

  // Step 5: 初始化 wx-cli
  const handleInitWxCli = useCallback(async () => {
    setInitializing(true)
    setInitResult(null)
    try {
      const result = await window.electron?.wechatAgent?.initWxCli()
      if (result?.ok) {
        setInitResult({ ok: true, message: '初始化成功！' })
      } else {
        setInitResult({ ok: false, message: result?.error || '初始化失败' })
      }
    } catch (e: any) {
      setInitResult({ ok: false, message: e?.message || '初始化异常' })
    }
    setInitializing(false)
  }, [])

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
            <p className="onboarding-desc">只需 4 步即可完成设置，让 AI 帮你自动回复微信消息。</p>
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
                <span>初始化微信接口</span>
              </div>
              <div className="onboarding-step-item">
                <span className="onboarding-step-num">4</span>
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
                  {wechatStatus.running && (
                    <p className="onboarding-detail">状态: 运行中</p>
                  )}
                  {wechatStatus.needsInstall && (
                    <p className="onboarding-detail warning">
                      ⚠️ 需要 4.1.9 版本，当前版本可能不兼容
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="onboarding-result">
                <p className="onboarding-desc">未检测到微信，请先安装微信 4.1.9。</p>
                <button
                  className="btn btn-secondary"
                  onClick={handleOpenDownload}
                >
                  📥 下载微信
                </button>
                <p className="onboarding-hint">
                  下载完成后请安装微信，然后点击"下一步"继续。
                </p>
              </div>
            )}
            <div className="onboarding-actions">
              <button className="btn btn-secondary" onClick={() => setStep('welcome')}>
                上一步
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-secondary" onClick={() => void checkWeChat()}>
                  🔄 重新检测
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
                {saving ? '保存中...' : '下一步'}
              </button>
            </div>
          </div>
        )

      case 'init':
        return (
          <div className="onboarding-step">
            <div className="onboarding-icon">🔧</div>
            <h2>初始化微信接口</h2>
            <p className="onboarding-desc">
              需要初始化微信数据接口（需要管理员权限）。请确保微信已登录。
            </p>

            {initResult && (
              <div className={`onboarding-result ${initResult.ok ? 'success' : 'error'}`}>
                <span className="onboarding-check">{initResult.ok ? '✓' : '✗'}</span>
                <p>{initResult.message}</p>
              </div>
            )}

            <button
              className="btn btn-primary"
              onClick={handleInitWxCli}
              disabled={initializing}
            >
              {initializing ? '初始化中...' : '开始初始化'}
            </button>

            <div className="onboarding-actions">
              <button className="btn btn-secondary" onClick={() => setStep('identity')}>
                上一步
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setStep('done')}
              >
                跳过（稍后在设置中初始化）
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
            <p className="onboarding-hint">
              如果还没有初始化微信接口，请在设置中完成。
            </p>
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

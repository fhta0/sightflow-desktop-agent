// sightflow-desktop-agent/src/renderer/src/LogViewer.tsx
import { useState, useEffect, useRef, useCallback } from 'react'

interface LogEntry {
  time: string
  type: string
  contact?: string
  content: string
}

type LogType = 'receive' | 'reply' | 'skip' | 'error' | 'info' | 'thinking' | 'monitor' | 'heartbeat'

const LOG_TYPE_LABELS: Record<string, string> = {
  receive: '收到',
  reply: '回复',
  monitor: '监控',
  skip: '跳过',
  error: '错误',
  info: '信息',
  heartbeat: '心跳',
  thinking: '思考',
}

function formatLogTime(timestamp?: number): string {
  const ms = timestamp || Date.now()
  return new Date(ms).toLocaleTimeString('en-US', { hour12: false })
}

function entryFromLog(l: any): LogEntry {
  return {
    time: formatLogTime(l.timestamp),
    type: l.type || 'info',
    contact: l.contact,
    content: l.content || ''
  }
}

export function LogViewer(): React.JSX.Element {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState<LogType | 'all'>('all')
  const [search, setSearch] = useState('')
  const [paused, setPaused] = useState(false)
  const [fetchState, setFetchState] = useState<'loading' | 'ready' | 'error'>('loading')
  const logEndRef = useRef<HTMLDivElement>(null)
  const pendingRef = useRef<LogEntry[]>([])

  // 组件挂载时拉取历史日志（带重试）
  useEffect(() => {
    let cancelled = false
    let attempts = 0
    const maxAttempts = 3

    const tryFetch = () => {
      if (cancelled) return
      attempts++
      fetch('http://127.0.0.1:12680/skill/logs')
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then(data => {
          if (cancelled) return
          if (data?.ok && Array.isArray(data.logs)) {
            const entries: LogEntry[] = data.logs.map(entryFromLog)
            setLogs(entries)
            setFetchState('ready')
          } else {
            // 返回了但无日志，标记为 ready（可能是刚启动）
            setFetchState('ready')
          }
        })
        .catch(() => {
          if (cancelled) return
          if (attempts < maxAttempts) {
            // 300ms 后重试
            setTimeout(tryFetch, 300)
          } else {
            setFetchState('error')
          }
        })
    }

    tryFetch()
    return () => { cancelled = true }
  }, [])

  // 监听 wechat-agent:glue-layer-log 事件（实时追加）
  useEffect(() => {
    const cleanup = window.electron?.on('wechat-agent:glue-layer-log', (data: unknown) => {
      let entry: LogEntry
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data
        if (parsed && typeof parsed === 'object' && (parsed as any).type) {
          entry = {
            time: formatLogTime((parsed as any).timestamp),
            type: (parsed as Record<string, string>).type,
            contact: (parsed as Record<string, string>).contact,
            content: (parsed as Record<string, string>).content || ''
          }
        } else {
          entry = {
            time: formatLogTime(),
            type: 'info',
            content: typeof data === 'string' ? data : JSON.stringify(data)
          }
        }
      } catch {
        entry = {
          time: formatLogTime(),
          type: 'info',
          content: typeof data === 'string' ? data : String(data)
        }
      }

      if (paused) {
        pendingRef.current.push(entry)
      } else {
        setLogs(prev => [...prev.slice(-499), entry])
      }
    })
    return cleanup
  }, [paused])

  // 恢复暂停时，追加累积的日志
  const handleResume = useCallback(() => {
    if (pendingRef.current.length > 0) {
      setLogs(prev => [...prev, ...pendingRef.current].slice(-500))
      pendingRef.current = []
    }
    setPaused(false)
  }, [])

  // 自动滚动
  useEffect(() => {
    if (!paused && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, paused])

  // 计算当前存在的日志类型（用于过滤按钮）
  const existingTypes = new Set(logs.map(l => l.type))

  // 只显示"全部"和当前有日志的类型按钮
  const visibleFilters = [
    { key: 'all' as const, label: '全部' },
    ...Object.entries(LOG_TYPE_LABELS)
      .filter(([key]) => existingTypes.has(key))
      .map(([key, label]) => ({ key: key as LogType, label }))
  ]

  // 过滤 + 搜索
  const filteredLogs = logs.filter(entry => {
    if (filter !== 'all' && entry.type !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        entry.content.toLowerCase().includes(q) ||
        (entry.contact || '').toLowerCase().includes(q)
      )
    }
    return true
  })

  const handleClear = useCallback(() => {
    setLogs([])
    pendingRef.current = []
  }, [])

  // 重试历史日志拉取
  const handleRetry = useCallback(() => {
    setFetchState('loading')
    fetch('http://127.0.0.1:12680/skill/logs')
      .then(r => r.json())
      .then(data => {
        if (data?.ok && Array.isArray(data.logs)) {
          const entries: LogEntry[] = data.logs.map(entryFromLog)
          setLogs(entries)
        }
        setFetchState('ready')
      })
      .catch(() => setFetchState('error'))
  }, [])

  return (
    <div className="settings-page slide-up">
      <div className="settings-page-header">
        <div>
          <h1>日志</h1>
          <p>实时查看粘合层和消息处理日志。</p>
        </div>
      </div>

      {/* 连接状态提示 */}
      {fetchState === 'loading' && logs.length === 0 && (
        <div className="log-viewer-status">正在获取历史日志...</div>
      )}
      {fetchState === 'error' && logs.length === 0 && (
        <div className="log-viewer-status log-viewer-error">
          无法连接日志服务，
          <button className="log-retry-btn" onClick={handleRetry}>点击重试</button>
        </div>
      )}

      {/* 工具栏 */}
      {logs.length > 0 && (
        <div className="log-toolbar">
          <div className="log-filters">
            {visibleFilters.map(({ key, label }) => (
              <button
                key={key}
                className={`log-filter-btn ${filter === key ? 'active' : ''}`}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="log-toolbar-actions">
            <input
              className="form-input log-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索..."
            />
            <button
              className={`log-toolbar-btn ${paused ? 'paused' : ''}`}
              onClick={() => paused ? handleResume() : setPaused(true)}
              title={paused ? '继续' : '暂停滚动'}
            >
              {paused ? '▶' : '⏸'}
            </button>
            <button className="log-toolbar-btn" onClick={handleClear} title="清空">
              🗑
            </button>
          </div>
        </div>
      )}

      {/* 日志区域 */}
      <div className="log-viewer-container">
        {filteredLogs.length === 0 ? (
          <div className="log-viewer-empty">
            {logs.length === 0
              ? (fetchState === 'loading' ? '正在获取日志...' : '暂无日志')
              : '没有匹配的日志'}
          </div>
        ) : (
          <div className="log-viewer-list">
            {filteredLogs.map((entry, i) => (
              <div className="log-viewer-entry" key={i}>
                <span className="log-time">{entry.time}</span>
                <span className={`log-type ${entry.type}`}>
                  {LOG_TYPE_LABELS[entry.type] || entry.type}
                </span>
                {entry.contact && <span className="log-contact">{entry.contact}:</span>}
                <span className="log-content">{entry.content}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
        {paused && pendingRef.current.length > 0 && (
          <div className="log-paused-badge">
            已暂停 · {pendingRef.current.length} 条新日志
          </div>
        )}
      </div>
    </div>
  )
}

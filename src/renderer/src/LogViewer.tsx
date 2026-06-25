// sightflow-desktop-agent/src/renderer/src/LogViewer.tsx
import { useState, useEffect, useRef, useCallback } from 'react'

interface LogEntry {
  time: string
  type: string
  contact?: string
  content: string
}

type LogType = 'receive' | 'reply' | 'skip' | 'error' | 'info' | 'thinking' | 'monitor' | 'heartbeat'

const LOG_TYPES: { key: LogType | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'receive', label: '收到' },
  { key: 'reply', label: '回复' },
  { key: 'monitor', label: '监控' },
  { key: 'skip', label: '跳过' },
  { key: 'error', label: '错误' },
  { key: 'info', label: '信息' },
  { key: 'heartbeat', label: '心跳' },
]

export function LogViewer(): React.JSX.Element {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState<LogType | 'all'>('all')
  const [search, setSearch] = useState('')
  const [paused, setPaused] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const pendingRef = useRef<LogEntry[]>([])

  // 监听 glue-layer:log 事件
  useEffect(() => {
    const cleanup = window.electron?.on('glue-layer:log', (data: unknown) => {
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data
        if (parsed && typeof parsed === 'object') {
          const entry: LogEntry = {
            time: new Date().toLocaleTimeString('en-US', { hour12: false }),
            type: (parsed as Record<string, string>).type || 'info',
            contact: (parsed as Record<string, string>).contact,
            content: (parsed as Record<string, string>).content || ''
          }

          if (paused) {
            pendingRef.current.push(entry)
          } else {
            setLogs(prev => [...prev.slice(-499), entry])
          }
        }
      } catch {
        // 非 JSON 格式的日志
        const entry: LogEntry = {
          time: new Date().toLocaleTimeString('en-US', { hour12: false }),
          type: 'info',
          content: typeof data === 'string' ? data : String(data)
        }
        if (paused) {
          pendingRef.current.push(entry)
        } else {
          setLogs(prev => [...prev.slice(-499), entry])
        }
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

  return (
    <div className="settings-page slide-up">
      <div className="settings-page-header">
        <div>
          <h1>日志</h1>
          <p>实时查看粘合层和消息处理日志。</p>
        </div>
      </div>

      {/* 工具栏 */}
      <div className="log-toolbar">
        <div className="log-filters">
          {LOG_TYPES.map(({ key, label }) => (
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

      {/* 日志区域 */}
      <div className="log-viewer-container">
        {filteredLogs.length === 0 ? (
          <div className="log-viewer-empty">
            {logs.length === 0 ? '等待日志...' : '没有匹配的日志'}
          </div>
        ) : (
          <div className="log-viewer-list">
            {filteredLogs.map((entry, i) => (
              <div className="log-viewer-entry" key={i}>
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

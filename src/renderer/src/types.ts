// sightflow-desktop-agent/src/renderer/src/types.ts
// 共享类型定义

export interface AlertData {
  severity: 'critical' | 'warning' | 'info'
  code: string
  message: string
  timestamp: number
}

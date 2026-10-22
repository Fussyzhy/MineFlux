import { useEffect, useRef } from 'react'
import type { LogLine } from '../../shared/types'
import { formatTime } from '../lib/format'

export function LogPanel({ logs }: { logs: LogLine[] }) {
  const listRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)

  useEffect(() => {
    const element = listRef.current
    if (element && followRef.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [logs.length])

  return (
    <div className="card log-card">
      <div className="card-head">
        <span>运行日志</span>
        <span className="muted small">{logs.length} 行</span>
      </div>
      <div
        className="log-body"
        ref={listRef}
        onScroll={() => {
          const element = listRef.current
          if (!element) return
          followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40
        }}
      >
        {logs.length === 0 && <div className="log-empty">还没有日志，开始下载后会显示详细过程。</div>}
        {logs.map((line, index) => (
          <div className={`log-line log-${line.level}`} key={`${line.time}-${index}`}>
            <span className="log-time">{formatTime(line.time)}</span>
            <span className="log-text">{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

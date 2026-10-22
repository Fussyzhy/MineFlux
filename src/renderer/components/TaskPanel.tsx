import type { TaskSnapshot } from '../../shared/types'
import { formatBytes, formatDuration, formatSpeed, percent, shortPath } from '../lib/format'
import {
  IconAlert,
  IconCheck,
  IconDownload,
  IconFolder,
  IconPause,
  IconPlay,
  IconRefresh,
  IconStop,
} from './Icons'

interface Props {
  task: TaskSnapshot | null
  error: string | null
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onRetry: () => void
  onReveal: () => void
}

const STATE_META: Record<string, { label: string; className: string }> = {
  running: { label: '下载中', className: 'pill-running' },
  paused: { label: '已暂停', className: 'pill-paused' },
  finished: { label: '已完成', className: 'pill-done' },
  failed: { label: '有失败项', className: 'pill-failed' },
  canceled: { label: '已取消', className: 'pill-idle' },
}

export function TaskPanel({
  task,
  error,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onReveal,
}: Props) {
  if (!task) {
    return (
      <div className="card task-card task-empty">
        <div className="empty-art">
          <IconDownload />
        </div>
        <div className="empty-title">还没有安装任务</div>
        <div className="empty-sub">
          在「下载」页选择 Minecraft 版本、配置实例名称与加载器后点「开始下载」；整合包可以直接拖入下载页。
          任务开始后这里会显示进度、分阶段耗时与失败重试。
        </div>
        <div className="row gap8">
          <button className="btn" onClick={onReveal}>
            <IconFolder />
            打开目录
          </button>
        </div>
        {error && (
          <div className="error-banner">
            <IconAlert />
            <span>{error}</span>
          </div>
        )}
      </div>
    )
  }

  const state = STATE_META[task.state] ?? STATE_META.running
  const overall = percent(task.doneBytes, task.totalBytes)
  const active = task.state === 'running'
  const paused = task.state === 'paused'
  const hasFailures = task.failures.length > 0
  const finished = task.state === 'finished'

  return (
    <div className="card task-card">
      <div className="task-head">
        <div className="task-title">
          <span className="version-strong">
            {task.instanceName}
            {task.instanceName !== task.versionId ? `（${task.versionId}）` : ''}
          </span>
          <span className={`pill ${state.className}`}>
            {finished ? <IconCheck /> : active ? <IconDownload /> : null}
            {state.label}
          </span>
        </div>
        <div className="task-sub" title={task.root}>
          {shortPath(task.root, 64)}
        </div>
      </div>

      <div className="progress-block">
        <div className="progress-top">
          <div className="progress-percent">{overall.toFixed(1)}%</div>
          <div className="progress-stats">
            <span>{formatSpeed(task.speed)}</span>
            <span className="dot" />
            <span>
              {formatBytes(task.doneBytes)} / {task.totalBytes > 0 ? formatBytes(task.totalBytes) : '—'}
            </span>
            <span className="dot" />
            <span>
              {task.doneFiles}/{task.totalFiles} 文件
            </span>
            <span className="dot" />
            <span>剩余 {formatDuration(task.etaSeconds)}</span>
          </div>
        </div>
        <div className="bar bar-lg">
          <div
            className={`bar-fill ${active ? 'bar-animated' : ''}`}
            style={{ width: `${overall}%` }}
          />
        </div>
        <div className="task-message">{task.message}</div>
      </div>

      <div className="stages">
        {task.stages
          .filter((stage) => stage.totalFiles > 0)
          .map((stage) => {
            const stagePercent = percent(stage.doneBytes, stage.totalBytes)
            const isCurrent =
              active &&
              stage.doneFiles < stage.totalFiles &&
              task.stages.find((item) => item.doneFiles < item.totalFiles)?.id === stage.id
            return (
              <div className="stage" key={stage.id}>
                <div className="stage-name">
                  <span className={isCurrent ? 'stage-current' : undefined}>{stage.label}</span>
                  <span className="muted small">
                    {stage.doneFiles}/{stage.totalFiles}
                  </span>
                </div>
                <div className="bar bar-sm">
                  <div className="bar-fill" style={{ width: `${stagePercent}%` }} />
                </div>
              </div>
            )
          })}
      </div>

      {hasFailures && (
        <div className="failures">
          <div className="failures-head">
            <IconAlert />
            <span>{task.failures.length} 个文件失败</span>
          </div>
          <div className="failure-list">
            {task.failures.slice(0, 6).map((failure) => (
              <div className="failure-row" key={failure.path}>
                <span className="failure-path" title={failure.path}>
                  {shortPath(failure.path, 56)}
                </span>
                <span className="failure-error" title={failure.error}>
                  {failure.error}
                </span>
              </div>
            ))}
            {task.failures.length > 6 && (
              <div className="failure-row muted">还有 {task.failures.length - 6} 个失败文件…</div>
            )}
          </div>
        </div>
      )}

      <div className="task-actions">
        {active && (
          <button className="btn" onClick={onPause}>
            <IconPause />
            暂停
          </button>
        )}
        {paused && (
          <button className="btn btn-primary" onClick={onResume}>
            <IconPlay />
            继续
          </button>
        )}
        {hasFailures && !active && (
          <button className="btn btn-primary" onClick={onRetry}>
            <IconRefresh />
            重试失败文件
          </button>
        )}
        {(active || paused || task.state === 'canceled') && (
          <button className="btn btn-ghost" onClick={onCancel}>
            <IconStop />
            取消
          </button>
        )}
        {finished && (
          <button className="btn btn-primary" onClick={onRetry}>
            <IconRefresh />
            再次校验 / 补全
          </button>
        )}
        <button className="btn" onClick={onReveal}>
          <IconFolder />
          打开目录
        </button>
        {error && (
          <span className="inline-error">
            <IconAlert />
            {error}
          </span>
        )}
      </div>
    </div>
  )
}


import type { TaskSnapshot } from '../../shared/types'
import { formatBytes, percent } from '../lib/format'
import { IconAlert, IconDownload } from './Icons'

interface Props {
  task: TaskSnapshot | null
  onOpen: () => void
}

const STATE_LABEL: Record<string, string> = {
  running: '下载中',
  paused: '已暂停',
  finished: '已完成',
  failed: '有失败项',
  canceled: '已取消',
}

/** 下载页里的迷你进度卡（完整进度与日志在「任务」页） */
export function MiniTask({ task, onOpen }: Props) {
  if (!task) return null
  const overall = percent(task.doneBytes, task.totalBytes)
  const failed = task.failures.length > 0

  return (
    <div className="card mini-task">
      <div className="mini-task-head">
        <IconDownload />
        <span className="mini-task-name">
          {task.instanceName}
          {task.instanceName !== task.versionId ? `（${task.versionId}）` : ''}
        </span>
        <span className={`pill ${failed ? 'pill-failed' : stateClass(task.state)}`}>
          {failed ? <IconAlert /> : null}
          {failed ? `${task.failures.length} 个失败` : (STATE_LABEL[task.state] ?? task.state)}
        </span>
        <div className="mini-task-actions">
          <button className="btn btn-sm" onClick={onOpen}>
            查看任务
          </button>
        </div>
      </div>
      <div className="bar bar-sm">
        <div
          className={`bar-fill ${task.state === 'running' ? 'bar-animated' : ''}`}
          style={{ width: `${overall}%` }}
        />
      </div>
      <div className="progress-mini">
        <span>{overall.toFixed(1)}%</span>
        <span>·</span>
        <span>
          {formatBytes(task.doneBytes)} / {formatBytes(task.totalBytes)}
        </span>
        <span>·</span>
        <span>
          {task.doneFiles}/{task.totalFiles} 文件
        </span>
        <span>·</span>
        <span>{task.message}</span>
      </div>
    </div>
  )
}

function stateClass(state: TaskSnapshot['state']): string {
  if (state === 'finished') return 'pill-done'
  if (state === 'paused') return 'pill-paused'
  if (state === 'running') return 'pill-running'
  return 'pill-idle'
}

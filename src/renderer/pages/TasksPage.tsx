import type { LogLine, TaskSnapshot } from '../../shared/types'
import { LogPanel } from '../components/LogPanel'
import { PageHeader } from '../components/PageHeader'
import { TaskPanel } from '../components/TaskPanel'

interface Props {
  task: TaskSnapshot | null
  logs: LogLine[]
  error: string | null
  onPause: () => void
  onResume: () => void
  onCancel: () => void
  onRetry: () => void
  onReveal: () => void
}

/** 任务页（PCL 的「任务管理」）：完整进度、分阶段进度与运行日志 */
export function TasksPage({
  task,
  logs,
  error,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onReveal,
}: Props) {
  return (
    <div className="page">
      <PageHeader
        title="任务"
        subtitle="下载任务的实时进度、失败重试与运行日志"
        actions={<span className="muted small">{task ? `任务 ${task.taskId}` : '暂无任务'}</span>}
      />
      <div className="page-body fill">
        <TaskPanel
          task={task}
          error={error}
          onPause={onPause}
          onResume={onResume}
          onCancel={onCancel}
          onRetry={onRetry}
          onReveal={onReveal}
        />
        <LogPanel logs={logs} />
      </div>
    </div>
  )
}

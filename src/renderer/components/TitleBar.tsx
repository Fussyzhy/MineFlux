import type { ReactElement } from 'react'
import type { JavaReport, TaskSnapshot, WindowAction } from '../../shared/types'
import type { PageId } from '../lib/nav'
import iconUrl from '../assets/mineflux.png'
import {
  IconClose,
  IconDownload,
  IconInfo,
  IconInstance,
  IconMinus,
  IconRestore,
  IconSettings,
  IconSquare,
  IconTasks,
} from './Icons'

interface Props {
  page: PageId
  onPage: (page: PageId) => void
  javaReport: JavaReport | null
  task: TaskSnapshot | null
  maximized: boolean
  onWindow: (action: WindowAction) => void
}

const NAV: Array<{ id: PageId; label: string; icon: ReactElement }> = [
  { id: 'download', label: '下载', icon: <IconDownload /> },
  { id: 'instances', label: '实例管理', icon: <IconInstance /> },
  { id: 'tasks', label: '任务', icon: <IconTasks /> },
  { id: 'settings', label: '设置', icon: <IconSettings /> },
  { id: 'about', label: '关于', icon: <IconInfo /> },
]

function javaLabel(report: JavaReport | null): string {
  if (!report) return '检测 Java…'
  if (!report.found) return '未检测到 Java'
  const latest = report.versions[report.versions.length - 1]
  return latest ? `Java ${latest.major}` : `Java ${report.found} 个`
}

/** PCL 式标题栏：Logo + 顶部导航 + 窗口控制按钮（无系统边框） */
export function TitleBar({ page, onPage, javaReport, task, maximized, onWindow }: Props) {
  const taskRunning = task?.state === 'running' || task?.state === 'paused'
  const taskFailed = task?.state === 'failed'
  const javaWarn = javaReport ? javaReport.found === 0 : false
  // 详细配置页属于「下载」流程，标题栏仍高亮下载
  const activePage = page === 'install' ? 'download' : page

  return (
    <header className="titlebar">
      <div className="brand">
        <img className="brand-logo" src={iconUrl} alt="MineFlux" draggable={false} />
        <div>
          <div className="brand-title">MineFlux</div>
          <div className="brand-sub">第三方 · 非官方 · 仅下载</div>
        </div>
      </div>

      <nav className="nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${activePage === item.id ? 'active' : ''}`}
            data-page={item.id}
            onClick={() => onPage(item.id)}
          >
            {item.icon}
            {item.label}
            {item.id === 'tasks' && (taskRunning || taskFailed) && (
              <span className={`nav-dot ${taskFailed ? 'failed' : ''}`} />
            )}
          </button>
        ))}
      </nav>

      <div className="titlebar-right">
        <button
          className={`titlebar-pill ${javaWarn ? 'warn' : ''}`}
          title={
            javaReport?.versions.length
              ? javaReport.versions.map((item) => `${item.version}（${item.path}）`).join('\n')
              : (javaReport?.note ?? '正在检测 Java')
          }
          onClick={() => onPage('settings')}
        >
          <IconInfo />
          {javaLabel(javaReport)}
        </button>
        <div className="window-btns">
          <button className="win-btn" title="最小化" onClick={() => onWindow('minimize')}>
            <IconMinus />
          </button>
          <button
            className="win-btn"
            title={maximized ? '还原' : '最大化'}
            onClick={() => onWindow('maximize')}
          >
            {maximized ? <IconRestore /> : <IconSquare />}
          </button>
          <button className="win-btn close" title="关闭" onClick={() => onWindow('close')}>
            <IconClose />
          </button>
        </div>
      </div>
    </header>
  )
}

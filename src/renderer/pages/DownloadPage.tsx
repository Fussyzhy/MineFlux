import type { ComponentProps } from 'react'
import type {
  InstalledInstance,
  JavaReport,
  Settings,
  SourceMode,
  TaskSnapshot,
  VersionListResult,
  VersionSummary,
} from '../../shared/types'
import type { DownloadTab } from '../lib/nav'
import { formatDate, shortPath } from '../lib/format'
import { MiniTask } from '../components/MiniTask'
import { ModpackPanel } from '../components/ModpackPanel'
import { PageHeader } from '../components/PageHeader'
import { SideNav } from '../components/SideNav'
import { VersionList } from '../components/VersionList'
import {
  IconAlert,
  IconDownload,
  IconFolder,
  IconRefresh,
} from '../components/Icons'

const SOURCE_OPTIONS: Array<{ value: SourceMode; label: string }> = [
  { value: 'auto', label: '自动（镜像优先）' },
  { value: 'official', label: '官方源优先' },
  { value: 'mirror', label: '仅 BMCLAPI 镜像' },
]

const TABS = [
  { id: 'version', label: '原版游戏', icon: <IconDownload /> },
  { id: 'modpack', label: '整合包', icon: <IconFolder /> },
]

const TYPE_LABEL: Record<string, string> = {
  release: '正式版',
  snapshot: '快照',
  old_beta: '远古 β 版',
  old_alpha: '远古 α 版',
}

interface RootCardProps {
  settings: Settings
  installedCount: number
  baseCount: number
  javaReport: JavaReport | null
  onPickFolder: () => void
  onOpen: () => void
}

function RootCard({
  settings,
  installedCount,
  baseCount,
  javaReport,
  onPickFolder,
  onOpen,
}: RootCardProps) {
  return (
    <div className="card target-card">
      <div className="field-label">安装目录</div>
      <div className="target-path" title={settings.root}>
        {settings.root ? shortPath(settings.root, 46) : '（未设置）'}
      </div>
      <div className="row gap8">
        <button className="btn btn-sm" onClick={onPickFolder}>
          <IconFolder />
          浏览
        </button>
        <button className="btn btn-sm" disabled={!settings.root} onClick={onOpen}>
          打开
        </button>
        <span className="muted small">
          已安装 {installedCount} 个实例
          {baseCount > 0 ? ` · ${baseCount} 个原版基座` : ''}
        </span>
        <span
          className={`java-badge ${javaReport && javaReport.found === 0 ? 'java-badge-warn' : ''}`}
          title={
            javaReport?.versions.length
              ? javaReport.versions.map((item) => `${item.version}（${item.path}）`).join('\n')
              : (javaReport?.note ?? '')
          }
        >
          {javaReport
            ? javaReport.found
              ? `Java ${javaReport.versions[javaReport.versions.length - 1]?.major}`
              : '未检测到 Java'
            : '检测 Java…'}
        </span>
      </div>
    </div>
  )
}

interface Props {
  tab: DownloadTab
  onTab: (tab: DownloadTab) => void
  settings: Settings
  onSettings: (patch: Partial<Settings>) => void
  versions: VersionListResult | null
  versionsLoading: boolean
  versionsError: string | null
  onRefreshVersions: () => void
  selectedId: string | null
  selected: VersionSummary | null
  onSelect: (version: VersionSummary) => void
  installedByVersion: Map<string, InstalledInstance[]>
  installedCount: number
  baseCount: number
  javaReport: JavaReport | null
  busy: boolean
  task: TaskSnapshot | null
  error: string | null
  onPickFolder: () => void
  onOpenRoot: () => void
  onConfigure: (version: VersionSummary) => void
  onOpenTasks: () => void
  modpack: ComponentProps<typeof ModpackPanel>
}

/** 下载页（PCL 的「下载」页）：左侧子导航切换原版游戏 / 整合包 */
export function DownloadPage({
  tab,
  onTab,
  settings,
  onSettings,
  versions,
  versionsLoading,
  versionsError,
  onRefreshVersions,
  selectedId,
  selected,
  onSelect,
  installedByVersion,
  installedCount,
  baseCount,
  javaReport,
  busy,
  task,
  error,
  onPickFolder,
  onOpenRoot,
  onConfigure,
  onOpenTasks,
  modpack,
}: Props) {
  const allForVersion = selected ? (installedByVersion.get(selected.id) ?? []) : []
  /** 原版基座不算实例，版本详情里单独提示 */
  const installedList = allForVersion.filter((item) => !item.base)
  const hasBase = allForVersion.some((item) => item.base)

  return (
    <div className="page">
      <PageHeader
        title="下载"
        subtitle="从官方 / 镜像 CDN 下载 Minecraft 原版、加载器与整合包"
        actions={
          <>
            <span className="muted small">下载源</span>
            <select
              className="source-select"
              value={settings.mode}
              onChange={(event) => onSettings({ mode: event.target.value as SourceMode })}
            >
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              className="icon-btn"
              title="刷新版本清单"
              disabled={versionsLoading}
              onClick={onRefreshVersions}
            >
              <IconRefresh />
            </button>
            <span
              className="source-badge"
              title={
                versions ? `清单获取于 ${new Date(versions.fetchedAt).toLocaleTimeString()}` : ''
              }
            >
              {versionsLoading ? '加载中…' : (versions?.sourceLabel ?? '未连接')}
            </span>
          </>
        }
      />

      <div className="page-split">
        <SideNav items={TABS} value={tab} onChange={(id) => onTab(id as DownloadTab)} />
        <div className="page-body fill">
          {error && (
            <div className="error-banner">
              <IconAlert />
              <span>{error}</span>
            </div>
          )}

          {tab === 'version' ? (
            <div className="download-grid">
              <div className="download-col">
                <RootCard
                  settings={settings}
                  installedCount={installedCount} baseCount={baseCount}
                  javaReport={javaReport}
                  onPickFolder={onPickFolder}
                  onOpen={onOpenRoot}
                />
                <VersionList
                  versions={versions?.versions ?? []}
                  loading={versionsLoading}
                  error={versionsError}
                  selectedId={selectedId}
                  installed={installedByVersion}
                  latestRelease={versions?.latest.release}
                  onSelect={onSelect}
                  onStart={(version) => onConfigure(version)}
                />
              </div>

              <div className="download-col scroll">
                {selected ? (
                  <div className="card version-detail">
                    <div className="version-detail-head">
                      <div>
                        <div className="version-detail-name">Minecraft {selected.id}</div>
                        <div className="muted small">
                          {TYPE_LABEL[selected.type] ?? '未知类型'}
                          {selected.releaseTime
                            ? ` · 发布于 ${formatDate(selected.releaseTime)}`
                            : ''}
                        </div>
                      </div>
                      {installedList.length > 0 && (
                        <span className="badge badge-installed">
                          已安装 {installedList.length} 个实例
                        </span>
                      )}
                      {installedList.length === 0 && hasBase && (
                        <span className="badge badge-snapshot">已下载原版基座</span>
                      )}
                    </div>
                    <div className="settings-desc">
                      下一步进入「详细配置」，选择 Forge / NeoForge / Fabric 等加载器与
                      OptiFine、Fabric API 等组件，再开始下载。互斥的组合会自动禁用并提示原因。
                    </div>
                    <div className="install-actions">
                      <button
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => onConfigure(selected)}
                        data-install-config
                      >
                        <IconDownload />
                        {busy ? '安装进行中…' : '配置并安装'}
                      </button>
                      <span className="muted small">
                        {installedList.length > 0
                          ? `同名实例：${installedList.map((item) => item.name).join('、')}`
                          : hasBase
                            ? '已下载原版基座（加载器实例依赖它，不是独立实例）'
                            : '尚未安装该版本'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="card install-card">
                    <div className="card-title">安装选项</div>
                    <div className="muted small">先在左侧版本列表里选择一个 Minecraft 版本。</div>
                  </div>
                )}
                <MiniTask task={task} onOpen={onOpenTasks} />
                <div className="card settings-card">
                  <div className="settings-title">安装说明</div>
                  <div className="settings-desc">
                    加载器会按照 PCL 的顺序合并进实例 JSON：Forge / NeoForge → OptiFine →
                    LiteLoader → Fabric / Quilt，最后把 mods 放进实例目录。
                  </div>
                  <div className="settings-desc">
                    Forge 1.13+、NeoForge、OptiFine 1.14+ 使用官方安装器，需要本机安装 Java；
                    其余加载器可免 Java 安装。
                  </div>
                  <div className="settings-desc">
                    同名实例重复安装会按「补全 / 修复」处理：已存在的文件会校验 SHA1 后跳过。
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="download-grid">
              <div className="download-col scroll">
                <RootCard
                  settings={settings}
                  installedCount={installedCount} baseCount={baseCount}
                  javaReport={javaReport}
                  onPickFolder={onPickFolder}
                  onOpen={onOpenRoot}
                />
                <ModpackPanel {...modpack} />
              </div>
              <div className="download-col scroll">
                <div className="card settings-card">
                  <div className="settings-title">支持格式</div>
                  <div className="settings-desc">
                    CurseForge（manifest.json）、Modrinth（modrinth.index.json）、HMCL、MultiMC /
                    Prism、MCBBS、启动器嵌套包，以及 .minecraft 备份压缩包。
                  </div>
                  <div className="settings-desc">
                    把压缩包直接拖到左侧区域即可解析；解析后会显示版本、加载器、文件数与体积。
                  </div>
                </div>
                <div className="card settings-card">
                  <div className="settings-title">注意事项</div>
                  <div className="settings-desc">
                    CurseForge 整合包需要 API Key（在「设置 → 整合包」里填写），否则只能走镜像接口。
                  </div>
                  <div className="settings-desc">
                    .minecraft 备份包会直接解压覆盖到当前安装目录，请确认目录后再安装。
                  </div>
                  <div className="settings-desc">RAR 暂不支持，请先转成 zip。</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

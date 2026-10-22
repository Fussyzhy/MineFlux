import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  InstallComponents,
  InstallRequest,
  InstalledInstance,
  JavaReport,
  LogLine,
  ModpackInfo,
  Settings,
  SourceMode,
  TaskSnapshot,
  VersionListResult,
  VersionSummary,
  WindowAction,
} from '../shared/types'
import { TitleBar } from './components/TitleBar'
import { IconAlert } from './components/Icons'
import { DownloadPage } from './pages/DownloadPage'
import { InstallConfigPage } from './pages/InstallConfigPage'
import { InstancesPage } from './pages/InstancesPage'
import { SettingsPage } from './pages/SettingsPage'
import { TasksPage } from './pages/TasksPage'
import { AboutPage } from './pages/AboutPage'
import type { DownloadTab, PageId } from './lib/nav'
import { shortPath } from './lib/format'
import type { InstallOptionsState } from './lib/install-config'

const DEFAULT_SETTINGS: Settings = {
  root: '',
  mode: 'auto',
  concurrency: 24,
  verifyHashes: true,
  isolation: true,
  curseforgeApiKey: '',
}

function cleanError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

function sanitizeName(name: string): string {
  const value = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return value || 'Minecraft'
}

function cleanComponents(components: InstallComponents): InstallComponents {
  const result: InstallComponents = {}
  if (components.fabric) result.fabric = components.fabric
  if (components.quilt) result.quilt = components.quilt
  if (components.forge) result.forge = components.forge
  if (components.neoforge) result.neoforge = components.neoforge
  if (components.liteloader) result.liteloader = components.liteloader
  if (components.optifine) result.optifine = components.optifine
  if (components.fabricApi) result.fabricApi = true
  if (components.optifabric) result.optifabric = true
  return result
}

export default function App() {
  const api = window.mineflux

  const [page, setPage] = useState<PageId>('download')
  const [tab, setTab] = useState<DownloadTab>('version')
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [versions, setVersions] = useState<VersionListResult | null>(null)
  const [versionsLoading, setVersionsLoading] = useState(true)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [configVersion, setConfigVersion] = useState<VersionSummary | null>(null)
  const [task, setTask] = useState<TaskSnapshot | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [installed, setInstalled] = useState<InstalledInstance[]>([])
  const [error, setError] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState('0.2.0')
  const [javaReport, setJavaReport] = useState<JavaReport | null>(null)
  const [maximized, setMaximized] = useState(false)

  const [options, setOptions] = useState<InstallOptionsState>({
    instanceName: '',
    isolation: true,
    components: {},
  })

  const [modpackInfo, setModpackInfo] = useState<ModpackInfo | null>(null)
  const [modpackLoading, setModpackLoading] = useState(false)
  const [modpackError, setModpackError] = useState<string | null>(null)
  const [modpackName, setModpackName] = useState('')

  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    try {
      await action()
      return true
    } catch (caught) {
      setError(cleanError(caught))
      return false
    }
  }, [])

  const refreshInstalled = useCallback(
    async (root: string): Promise<void> => {
      if (!root) return
      try {
        setInstalled(await api.getInstalledVersions(root))
      } catch {
        setInstalled([])
      }
    },
    [api],
  )

  const refreshJava = useCallback(async (): Promise<void> => {
    try {
      setJavaReport(await api.detectJava())
    } catch {
      setJavaReport({ found: 0, versions: [], note: 'Java 检测失败' })
    }
  }, [api])

  // 初始化
  useEffect(() => {
    void (async () => {
      try {
        const loaded = await api.getSettings()
        setSettings(loaded)
        setOptions((previous) => ({ ...previous, isolation: loaded.isolation }))
        setAppVersion(await api.appVersion())
        await refreshInstalled(loaded.root)
        await refreshJava()
      } catch (caught) {
        setError(cleanError(caught))
      }
    })()
  }, [api, refreshInstalled, refreshJava])

  // 事件订阅
  useEffect(() => {
    return api.onEvent((event) => {
      if (event.type === 'snapshot') {
        setTask(event.snapshot)
      } else {
        setLogs((previous) => {
          const next = previous.length >= 900 ? previous.slice(-700) : previous
          return [...next, event.line]
        })
      }
    })
  }, [api])

  // 窗口最大化状态
  useEffect(() => {
    return api.onWindowState((state) => setMaximized(state.maximized))
  }, [api])

  // 版本清单
  const loadVersions = useCallback(
    async (mode: SourceMode): Promise<void> => {
      setVersionsLoading(true)
      setVersionsError(null)
      try {
        const result = await api.getVersions(mode)
        setVersions(result)
        setSelectedId((current) =>
          current && result.versions.some((item) => item.id === current)
            ? current
            : (result.latest.release ?? result.versions[0]?.id ?? null),
        )
      } catch (caught) {
        setVersionsError(cleanError(caught))
      } finally {
        setVersionsLoading(false)
      }
    },
    [api],
  )

  useEffect(() => {
    void loadVersions(settings.mode)
  }, [loadVersions, settings.mode])

  // 选中版本变化时同步实例名
  const selected: VersionSummary | null = useMemo(
    () => versions?.versions.find((version) => version.id === selectedId) ?? null,
    [versions, selectedId],
  )

  // 任务结束后刷新已安装实例
  const taskState = task?.state
  useEffect(() => {
    if (taskState === 'finished' || taskState === 'failed') {
      void refreshInstalled(settings.root)
    }
  }, [taskState, settings.root, refreshInstalled])

  const patchSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((previous) => {
        const next = { ...previous, ...patch }
        void api.saveSettings(next).catch(() => undefined)
        return next
      })
      setError(null)
    },
    [api],
  )

  const patchOptions = useCallback((patch: Partial<InstallOptionsState>) => {
    setOptions((previous) => ({ ...previous, ...patch }))
  }, [])

  const pickFolder = useCallback(async (): Promise<void> => {
    await run(async () => {
      const folder = await api.chooseFolder()
      if (!folder) return
      patchSettings({ root: folder })
      await refreshInstalled(folder)
    })
  }, [api, patchSettings, refreshInstalled, run])

  const installedByVersion = useMemo(() => {
    const map = new Map<string, InstalledInstance[]>()
    for (const instance of installed) {
      const key = instance.mcVersion ?? instance.name
      const list = map.get(key) ?? []
      list.push(instance)
      map.set(key, list)
    }
    return map
  }, [installed])

  const installedNames = useMemo(() => installed.map((item) => item.name), [installed])
  /** 原版基座不算「实例」，界面上单独统计 */
  const instanceCount = useMemo(() => installed.filter((item) => !item.base).length, [installed])
  const baseCount = useMemo(() => installed.filter((item) => item.base).length, [installed])

  const busy = task?.state === 'running' || task?.state === 'paused'

  /** 打开「详细配置」页（PCL 的安装详细配置）：重置组件，实例名用默认命名 */
  const openConfig = useCallback(
    (version: VersionSummary) => {
      setSelectedId(version.id)
      setConfigVersion(version)
      setOptions({
        instanceName: version.id,
        isolation: settings.isolation,
        components: {},
      })
      setError(null)
      setPage('install')
    },
    [settings.isolation],
  )

  const startVersion = useCallback(async (): Promise<void> => {
    const target = configVersion ?? selected
    if (!target) return
    setError(null)
    setLogs([])
    const instanceName = sanitizeName(options.instanceName || target.id)
    const request: InstallRequest = {
      kind: 'version',
      versionId: target.id,
      versionUrl: target.url,
      versionSha1: target.sha1,
      root: settings.root,
      instanceName,
      mode: settings.mode,
      concurrency: settings.concurrency,
      verifyHashes: settings.verifyHashes,
      manifestSource: versions?.source,
      components: cleanComponents(options.components),
      isolation: options.isolation,
      overwrite: installedNames.includes(instanceName),
    }
    const ok = await run(async () => {
      await api.saveSettings(settings)
      await api.startInstall(request)
    })
    if (ok) setPage('tasks')
  }, [api, configVersion, installedNames, options, run, selected, settings, versions])

  const inspectModpackFile = useCallback(
    async (file: string): Promise<void> => {
      setModpackLoading(true)
      setModpackError(null)
      setModpackInfo(null)
      try {
        const info = await api.inspectModpack(file)
        setModpackInfo(info)
        setModpackName(
          sanitizeName(
            info.name || file.replace(/^.*[\\/]/, '').replace(/\.(zip|mrpack|modpack)$/i, ''),
          ),
        )
      } catch (caught) {
        setModpackError(cleanError(caught))
      } finally {
        setModpackLoading(false)
      }
    },
    [api],
  )

  const startModpack = useCallback(async (): Promise<void> => {
    if (!modpackInfo) return
    setError(null)
    setLogs([])
    const instanceName = sanitizeName(modpackName || modpackInfo.name || 'Modpack')
    const request: InstallRequest = {
      kind: 'modpack',
      versionId: modpackInfo.mcVersion ?? '',
      root: settings.root,
      instanceName,
      mode: settings.mode,
      concurrency: settings.concurrency,
      verifyHashes: settings.verifyHashes,
      manifestSource: versions?.source,
      components: cleanComponents(modpackInfo.components),
      isolation: options.isolation,
      // 纯解压类整合包会直接覆盖游戏目录，UI 已经明确提示过
      overwrite: modpackInfo.type === 'compress' || installedNames.includes(instanceName),
      modpack: modpackInfo,
      curseforgeApiKey: settings.curseforgeApiKey,
    }
    const ok = await run(async () => {
      await api.saveSettings(settings)
      await api.startInstall(request)
    })
    if (ok) setPage('tasks')
  }, [api, installedNames, modpackInfo, modpackName, options.isolation, run, settings, versions])

  const toggleTask = useCallback(
    async (action: 'pause' | 'resume' | 'cancel' | 'retry'): Promise<void> => {
      if (!task) return
      await run(async () => {
        if (action === 'pause') await api.pause(task.taskId)
        else if (action === 'resume') await api.resume(task.taskId)
        else if (action === 'cancel') await api.cancel(task.taskId)
        else await api.retryFailed(task.taskId)
      })
    },
    [api, run, task],
  )

  // 实例管理：按安装清单补全 / 修复
  const repairInstance = useCallback(
    async (instance: InstalledInstance): Promise<void> => {
      const mcVersion = instance.mcVersion ?? instance.name
      const version = versions?.versions.find((item) => item.id === mcVersion)
      if (!version) {
        setError(`版本清单里找不到 ${mcVersion}，请先在下载页刷新版本列表`)
        setPage('download')
        return
      }
      setError(null)
      setLogs([])
      const request: InstallRequest = {
        kind: 'version',
        versionId: version.id,
        versionUrl: version.url,
        versionSha1: version.sha1,
        root: settings.root,
        instanceName: instance.name,
        mode: settings.mode,
        concurrency: settings.concurrency,
        verifyHashes: true,
        manifestSource: versions?.source,
        components: instance.components,
        isolation: instance.isolation ?? settings.isolation,
        overwrite: true,
      }
      const ok = await run(async () => {
        await api.saveSettings(settings)
        await api.startInstall(request)
      })
      if (ok) setPage('tasks')
    },
    [api, run, settings, versions],
  )

  const removeInstance = useCallback(
    async (instance: InstalledInstance): Promise<void> => {
      await run(async () => {
        await api.removeInstance(settings.root, instance.name)
        await refreshInstalled(settings.root)
      })
    },
    [api, refreshInstalled, run, settings.root],
  )

  const windowControl = useCallback(
    async (action: WindowAction): Promise<void> => {
      try {
        const isMaximized = await api.windowControl(action)
        setMaximized(isMaximized)
      } catch {
        // 忽略窗口控制错误
      }
    },
    [api],
  )

  return (
    <div className="app">
      <TitleBar
        page={page}
        onPage={setPage}
        javaReport={javaReport}
        task={task}
        maximized={maximized}
        onWindow={(action) => void windowControl(action)}
      />

      <div className="content-wrap">
        {error && page !== 'download' && (
          <div className="error-banner global">
            <IconAlert />
            <span>{error}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setError(null)}>
              知道了
            </button>
          </div>
        )}

        {page === 'download' && (
          <DownloadPage
            tab={tab}
            onTab={setTab}
            settings={settings}
            onSettings={patchSettings}
            versions={versions}
            versionsLoading={versionsLoading}
            versionsError={versionsError}
            onRefreshVersions={() => void loadVersions(settings.mode)}
            selectedId={selectedId}
            selected={selected}
            onSelect={(version) => setSelectedId(version.id)}
            installedByVersion={installedByVersion}
            installedCount={instanceCount}
            baseCount={baseCount}
            javaReport={javaReport}
            busy={busy}
            task={task}
            error={error}
            onPickFolder={() => void pickFolder()}
            onOpenRoot={() => void api.revealPath(settings.root)}
            onConfigure={(version) => openConfig(version)}
            onOpenTasks={() => setPage('tasks')}
            modpack={{
              info: modpackInfo,
              loading: modpackLoading,
              error: modpackError,
              busy,
              instanceName: modpackName,
              isolation: options.isolation,
              onPick: () =>
                void run(async () => {
                  const file = await api.chooseModpackFile()
                  if (file) await inspectModpackFile(file)
                }),
              onFile: (path) => void inspectModpackFile(path),
              onInstanceName: setModpackName,
              onIsolation: (value) => patchOptions({ isolation: value }),
              onInstall: () => void startModpack(),
              onClear: () => {
                setModpackInfo(null)
                setModpackError(null)
              },
            }}
          />
        )}

        {page === 'install' && configVersion && (
          <InstallConfigPage
            key={`${configVersion.id}-${settings.mode}`}
            version={configVersion}
            mode={settings.mode}
            options={options}
            onOptions={patchOptions}
            javaReport={javaReport}
            installedNames={installedNames}
            busy={busy}
            onBack={() => setPage('download')}
            onStart={() => void startVersion()}
          />
        )}

        {page === 'instances' && (
          <InstancesPage
            root={settings.root}
            installed={installed}
            busy={busy}
            onRefresh={() => void refreshInstalled(settings.root)}
            onOpenDir={(target) => void api.revealPath(target)}
            onRepair={(instance) => void repairInstance(instance)}
            onRemove={(instance) => void removeInstance(instance)}
            onGoDownload={() => setPage('download')}
          />
        )}

        {page === 'tasks' && (
          <TasksPage
            task={task}
            logs={logs}
            error={null}
            onPause={() => void toggleTask('pause')}
            onResume={() => void toggleTask('resume')}
            onCancel={() => void toggleTask('cancel')}
            onRetry={() => void toggleTask('retry')}
            onReveal={() => void api.revealPath(settings.root)}
          />
        )}

        {page === 'settings' && (
          <SettingsPage
            settings={settings}
            javaReport={javaReport}
            appVersion={appVersion}
            busy={busy}
            onSettings={patchSettings}
            onPickFolder={() => void pickFolder()}
            onDetectJava={() => void refreshJava()}
            onReveal={(target) => void api.revealPath(target)}
          />
        )}

        {page === 'about' && (
          <AboutPage
            appVersion={appVersion}
            javaReport={javaReport}
            onOpenExternal={(url) => void api.openExternal(url)}
          />
        )}
      </div>

      <footer className="statusbar">
        <span>仅从官方 / 镜像 CDN 下载文件，不包含游戏本体，不提供启动与登录功能</span>
        <span className="statusbar-right">
          <span>v{appVersion}</span>
          <span className="dot" />
          <span>{settings.root ? shortPath(settings.root, 46) : '未选择目录'}</span>
        </span>
      </footer>
    </div>
  )
}

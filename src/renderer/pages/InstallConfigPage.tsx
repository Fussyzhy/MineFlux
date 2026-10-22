import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  InstallComponents,
  JavaReport,
  LoaderId,
  ModVersionList,
  SourceMode,
  VersionSummary,
} from '../../shared/types'
import { formatDate } from '../lib/format'
import {
  buildConfigHints,
  buildConfigRows,
  defaultInstanceName,
  isLoaderVisible,
  needsManualOptiFabric,
  type ConfigContext,
  type ConfigLoaderId,
  type ConfigRow,
  type InstallOptionsState,
  type LoaderLists,
} from '../lib/install-config'
import {
  IconAlert,
  IconArrowLeft,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconDownload,
} from '../components/Icons'

interface Props {
  version: VersionSummary
  mode: SourceMode
  options: InstallOptionsState
  onOptions: (patch: Partial<InstallOptionsState>) => void
  javaReport: JavaReport | null
  installedNames: string[]
  busy: boolean
  onBack: () => void
  onStart: () => void
}

const LOADER_IDS: LoaderId[] = ['forge', 'neoforge', 'fabric', 'quilt', 'optifine', 'liteloader']

type ModListState = ModVersionList | 'loading' | { error: string }
type ModKey = 'fabricApi' | 'optifabric'

function selectedOf(id: ConfigLoaderId, components: InstallComponents): boolean {
  if (id === 'fabricApi') return Boolean(components.fabricApi)
  if (id === 'optifabric') return Boolean(components.optifabric)
  return Boolean(components[id as LoaderId])
}

/**
 * 详细配置页（对应 PCL 的「安装详细配置」页）：
 * 顶部返回 + 实例名，中间是互斥的组件列表，底部开始下载。
 */
export function InstallConfigPage({
  version,
  mode,
  options,
  onOptions,
  javaReport,
  installedNames,
  busy,
  onBack,
  onStart,
}: Props) {
  const api = window.mineflux
  const components = options.components
  const [lists, setLists] = useState<LoaderLists>({})
  const [mods, setMods] = useState<Partial<Record<ModKey, ModListState>>>({})
  const [expanded, setExpanded] = useState<ConfigLoaderId | null>(null)
  const autoRemoved = useRef<{ fabricApi?: boolean; optifabric?: boolean }>({})
  const nameEdited = useRef(false)

  const ctx: ConfigContext = useMemo(
    () => ({
      mcVersion: version.id,
      type: version.type,
      releaseTime: version.releaseTime,
      components,
      lists,
      javaReport,
    }),
    [version.id, version.type, version.releaseTime, components, lists, javaReport],
  )

  const rows = useMemo(() => buildConfigRows(ctx), [ctx])
  const hints = useMemo(() => buildConfigHints(ctx), [ctx])

  // 加载可见加载器的版本列表（隐藏的卡片不请求，减少网络请求）
  useEffect(() => {
    let cancelled = false
    const base: ConfigContext = {
      mcVersion: version.id,
      type: version.type,
      releaseTime: version.releaseTime,
      components: {},
      lists: {},
      javaReport: null,
    }
    const targets = LOADER_IDS.filter((id) => isLoaderVisible(id as ConfigLoaderId, base))
    setLists(Object.fromEntries(targets.map((id) => [id, 'loading' as const])))
    setExpanded(null)
    for (const id of targets) {
      void api
        .getLoaderVersions(id, version.id, mode)
        .then((list) => {
          if (cancelled) return
          setLists((previous) => ({ ...previous, [id]: list }))
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setLists((previous) => ({
            ...previous,
            [id]: { error: error instanceof Error ? error.message : String(error) },
          }))
        })
    }
    return () => {
      cancelled = true
    }
  }, [api, version.id, version.type, version.releaseTime, mode])

  // Fabric API / OptiFabric 的可用版本（Modrinth，仅用于展示版本号）
  useEffect(() => {
    let cancelled = false
    const requests: Array<{ key: ModKey; load: () => Promise<ModVersionList> }> = []
    if (components.fabric) {
      requests.push({
        key: 'fabricApi',
        load: () => api.getModVersions('fabric-api', version.id, ['fabric'], mode),
      })
    } else if (components.quilt) {
      requests.push({
        key: 'fabricApi',
        load: () => api.getModVersions('fabric-api', version.id, ['quilt'], mode),
      })
    }
    if (
      components.fabric &&
      components.optifine &&
      !needsManualOptiFabric(version.id)
    ) {
      requests.push({
        key: 'optifabric',
        load: () => api.getModVersions('optifabric', version.id, ['fabric'], mode),
      })
    }
    if (!requests.length) {
      setMods({})
      return
    }
    setMods(Object.fromEntries(requests.map((item) => [item.key, 'loading' as const])))
    for (const request of requests) {
      void request
        .load()
        .then((list) => {
          if (cancelled) return
          setMods((previous) => ({ ...previous, [request.key]: list }))
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setMods((previous) => ({
            ...previous,
            [request.key]: { error: error instanceof Error ? error.message : String(error) },
          }))
        })
    }
    return () => {
      cancelled = true
    }
  }, [api, components.fabric, components.quilt, components.optifine, version.id, mode])

  const autoVersion = (key: ModKey): string | undefined => {
    const state = mods[key]
    if (!state || state === 'loading' || 'error' in state) return undefined
    const version = state.versions[0]?.version
    // PCL 只显示 build 号之前的版本，例如 0.164.0+26.3 → 0.164.0
    return version?.split('+')[0]
  }

  // 未手动改过名字时，跟随所选组件自动生成实例名（PCL 的 GetSelectName）
  useEffect(() => {
    if (nameEdited.current) return
    const next = defaultInstanceName(version.id, components)
    if (next !== options.instanceName) onOptions({ instanceName: next })
  }, [version.id, components, options.instanceName, onOptions])

  const patchComponents = useCallback(
    (next: InstallComponents) => {
      onOptions({ components: next })
    },
    [onOptions],
  )

  const selectVersion = useCallback(
    (id: LoaderId, loaderVersion: string) => {
      const next: InstallComponents = { ...components, [id]: loaderVersion }
      if (id === 'fabric' || id === 'quilt') {
        if (!autoRemoved.current.fabricApi) next.fabricApi = true
        if (
          id === 'fabric' &&
          next.optifine &&
          !autoRemoved.current.optifabric &&
          !needsManualOptiFabric(version.id)
        ) {
          next.optifabric = true
        }
      } else if (id === 'optifine') {
        if (
          next.fabric &&
          !autoRemoved.current.optifabric &&
          !needsManualOptiFabric(version.id)
        ) {
          next.optifabric = true
        }
      }
      patchComponents(next)
      setExpanded(null)
    },
    [components, patchComponents, version.id],
  )

  const clear = useCallback(
    (id: ConfigLoaderId) => {
      const next: InstallComponents = { ...components }
      if (id === 'fabricApi') {
        next.fabricApi = undefined
        autoRemoved.current.fabricApi = true
      } else if (id === 'optifabric') {
        next.optifabric = undefined
        autoRemoved.current.optifabric = true
      } else if (id === 'fabric') {
        next.fabric = undefined
        next.fabricApi = undefined
        next.optifabric = undefined
        autoRemoved.current = {}
      } else if (id === 'quilt') {
        next.quilt = undefined
        next.fabricApi = undefined
        autoRemoved.current.fabricApi = false
      } else if (id === 'optifine') {
        next.optifine = undefined
        next.optifabric = undefined
        autoRemoved.current.optifabric = false
      } else if (id === 'forge') {
        next.forge = undefined
      } else if (id === 'neoforge') {
        next.neoforge = undefined
      } else if (id === 'liteloader') {
        next.liteloader = undefined
      }
      patchComponents(next)
      if (expanded === id) setExpanded(null)
    },
    [components, expanded, patchComponents],
  )

  const addAuto = useCallback(
    (id: 'fabricApi' | 'optifabric') => {
      const next: InstallComponents = { ...components }
      if (id === 'fabricApi') {
        next.fabricApi = true
        autoRemoved.current.fabricApi = false
      } else {
        next.optifabric = true
        autoRemoved.current.optifabric = false
      }
      patchComponents(next)
    },
    [components, patchComponents],
  )

  const onRowClick = useCallback(
    (row: ConfigRow) => {
      if (busy || row.error) return
      if (row.auto) {
        if (row.id === 'fabricApi' || row.id === 'optifabric') {
          if (selectedOf(row.id, components)) clear(row.id)
          else addAuto(row.id)
        }
        return
      }
      if (row.loading) return
      setExpanded((current) => (current === row.id ? null : row.id))
    },
    [addAuto, busy, clear, components],
  )

  const nameConflict = installedNames.includes(options.instanceName)
  const javaMissing = Boolean(javaReport && javaReport.found === 0)
  const selectedSummary = rows
    .filter((row) => selectedOf(row.id, components))
    .map((row) => {
      if (row.auto) {
        const version = autoVersion(row.id as ModKey)
        return version ? `${row.title} ${version}` : row.title
      }
      return row.version ? `${row.title} ${row.version}` : row.title
    })
    .join(' · ')

  const renderExpanded = (row: ConfigRow) => {
    if (expanded !== row.id) return null
    const state = lists[row.id as LoaderId]
    if (state === undefined || state === 'loading') {
      return (
        <div className="config-versions">
          <div className="config-loading">正在获取版本列表…</div>
        </div>
      )
    }
    if ('error' in state) {
      return (
        <div className="config-versions">
          <div className="config-loading error">{state.error}</div>
        </div>
      )
    }
    if (!state.versions.length) {
      return (
        <div className="config-versions">
          <div className="config-loading">{state.note ?? '没有可用版本'}</div>
        </div>
      )
    }
    const current = components[row.id as LoaderId]
    return (
      <div className="config-versions" data-config-versions={row.id}>
        {state.versions.map((item) => (
          <button
            key={item.version}
            className={`config-version ${current === item.version ? 'selected' : ''}`}
            disabled={busy}
            onClick={() => selectVersion(row.id as LoaderId, item.version)}
          >
            <span className="config-version-label">{item.label}</span>
            {item.recommended && <span className="badge badge-release">推荐</span>}
            {current === item.version && <IconCheck />}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="page config-page">
      <div className="config-inner">
        <div className="config-topbar">
          <button className="config-back" title="返回版本列表" onClick={onBack} data-config-back>
            <IconArrowLeft />
          </button>
          <span className="config-mc-chip">MC</span>
          <input
            className="config-name"
            value={options.instanceName}
            spellCheck={false}
            disabled={busy}
            data-config-name
            onChange={(event) => {
              nameEdited.current = true
              onOptions({ instanceName: event.target.value })
            }}
          />
          <label className="switch config-isolation">
            <input
              type="checkbox"
              checked={options.isolation}
              disabled={busy}
              onChange={(event) => onOptions({ isolation: event.target.checked })}
            />
            <span>版本隔离</span>
          </label>
        </div>

        <div className="config-head">
          <h1 className="config-title">详细配置</h1>
          <div className="page-sub">
            Minecraft {version.id} · 选择要一起安装的加载器与组件
            {version.releaseTime ? ` · 发布于 ${formatDate(version.releaseTime)}` : ''}
          </div>
        </div>

        <div className="config-rows" data-config-rows>
          {rows.map((row) => {
            const selected = selectedOf(row.id, components)
            const expandedRow = expanded === row.id
            return (
              <div
                key={row.id}
                className={`config-row ${row.error ? 'disabled' : ''} ${selected ? 'selected' : ''}`}
                data-config-row={row.id}
              >
                <div
                  className="config-row-head"
                  role="button"
                  tabIndex={row.error || busy ? -1 : 0}
                  onClick={() => onRowClick(row)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onRowClick(row)
                    }
                  }}
                >
                  <span className="config-row-title">{row.title}</span>
                  <span className="config-row-status">
                    {row.error ? (
                      <span className="config-row-error">{row.error}</span>
                    ) : row.loading ? (
                      '正在获取版本…'
                    ) : selected ? (
                      row.auto ? (
                        autoVersion(row.id as ModKey) ? (
                          <span className="config-row-version">
                            {autoVersion(row.id as ModKey)}
                          </span>
                        ) : (
                          '安装时自动选择最新兼容版本'
                        )
                      ) : (
                        <span className="config-row-version">{row.version}</span>
                      )
                    ) : (
                      '可以添加'
                    )}
                  </span>
                  <span className="config-row-tail">
                    {selected && (
                      <button
                        className="row-clear"
                        title="移除"
                        data-config-clear={row.id}
                        onClick={(event) => {
                          event.stopPropagation()
                          clear(row.id)
                        }}
                      >
                        <IconClose />
                      </button>
                    )}
                    {!row.auto && (
                      <span className={`config-row-chevron ${expandedRow ? 'open' : ''}`}>
                        {expandedRow ? <IconChevronDown /> : <IconChevronRight />}
                      </span>
                    )}
                  </span>
                </div>
                {renderExpanded(row)}
              </div>
            )
          })}
        </div>

        {hints.length > 0 && (
          <div className="config-hints">
            {hints.map((hint) => (
              <div key={hint.text} className={`inline-hint ${hint.tone === 'warn' ? 'warn' : ''}`}>
                {hint.tone === 'warn' && <IconAlert />}
                <span>{hint.text}</span>
              </div>
            ))}
          </div>
        )}

        {nameConflict && (
          <div className="inline-hint warn">
            <IconAlert />
            <span>同名实例已存在：继续安装会在原实例上补全 / 覆盖文件</span>
          </div>
        )}
        {javaMissing && rows.some((row) => row.requiresJava && selectedOf(row.id, components)) && (
          <div className="inline-hint warn">
            <IconAlert />
            <span>{javaReport?.note ?? '未检测到 Java：所选加载器需要 Java 才能完成安装'}</span>
          </div>
        )}
        {!javaMissing && javaReport && javaReport.found > 0 && selectedSummary && (
          <div className="inline-hint">
            <span>
              将使用 Java {javaReport.versions[javaReport.versions.length - 1]?.version}
            </span>
          </div>
        )}

        <div className="config-footer">
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={onStart}
            data-config-start
          >
            <IconDownload />
            {busy ? '安装进行中…' : '开始下载'}
          </button>
          <span className="config-summary">
            {selectedSummary ? `将安装 ${version.id} · ${selectedSummary}` : `仅安装原版 ${version.id} 客户端与资源`}
          </span>
        </div>
      </div>
    </div>
  )
}

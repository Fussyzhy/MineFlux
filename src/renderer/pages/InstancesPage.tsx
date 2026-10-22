import { useEffect, useMemo, useState } from 'react'
import type { InstallComponents, InstalledInstance } from '../../shared/types'
import { formatBytes, shortPath } from '../lib/format'
import { IconAlert, IconFolder, IconInstance, IconRefresh, IconTrash } from '../components/Icons'
import { PageHeader } from '../components/PageHeader'
import { SideNav } from '../components/SideNav'

function componentText(components: InstallComponents): string {
  const parts: string[] = []
  if (components.fabric) parts.push(`Fabric ${components.fabric}`)
  if (components.quilt) parts.push(`Quilt ${components.quilt}`)
  if (components.forge) parts.push(`Forge ${components.forge}`)
  if (components.neoforge) parts.push(`NeoForge ${components.neoforge}`)
  if (components.liteloader) parts.push(`LiteLoader ${components.liteloader}`)
  if (components.optifine) parts.push(`OptiFine ${components.optifine}`)
  if (components.fabricApi) parts.push('Fabric API')
  if (components.optifabric) parts.push('OptiFabric')
  return parts.length ? parts.join(' · ') : '原版'
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

interface Props {
  root: string
  installed: InstalledInstance[]
  busy: boolean
  onRefresh: () => void
  onOpenDir: (target: string) => void
  onRepair: (instance: InstalledInstance) => void
  onRemove: (instance: InstalledInstance) => void
  onGoDownload: () => void
}

/** 实例管理页（PCL 的「版本管理」）：左侧实例列表 + 右侧概览与操作 */
export function InstancesPage({
  root,
  installed,
  busy,
  onRefresh,
  onOpenDir,
  onRepair,
  onRemove,
  onGoDownload,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  /** 原版基座默认隐藏：它们是加载器实例依赖的原版版本目录，不是用户创建的实例 */
  const [showBases, setShowBases] = useState(false)

  const realInstances = useMemo(() => installed.filter((item) => !item.base), [installed])
  const bases = useMemo(() => installed.filter((item) => item.base), [installed])
  const visible = useMemo(
    () => (showBases ? [...realInstances, ...bases] : realInstances),
    [showBases, realInstances, bases],
  )

  useEffect(() => {
    setSelected((current) => {
      if (current && visible.some((item) => item.name === current)) return current
      return visible[0]?.name ?? null
    })
  }, [visible])

  const items = useMemo(
    () =>
      visible.map((item) => ({
        id: item.name,
        label: item.name,
        hint: [item.mcVersion ?? '未知版本', componentText(item.components)]
          .filter((part, index, list) => part && list.indexOf(part) === index)
          .join(' · '),
        icon: <IconInstance />,
        // 分组：安装中 > 本工具实例 > 外部实例 > 原版基座，避免把基座误标成「外部实例」
        section: item.installing
          ? '安装中'
          : item.base
            ? '原版基座'
            : item.managed
              ? '已安装实例'
              : '外部实例',
      })),
    [visible],
  )

  const current = installed.find((item) => item.name === selected) ?? null

  return (
    <div className="page">
      <PageHeader
        title="实例管理"
        subtitle={
          root
            ? [
                `共 ${realInstances.length} 个实例`,
                bases.length ? `${bases.length} 个原版基座` : '',
                shortPath(root, 44),
              ]
                .filter(Boolean)
                .join(' · ')
            : '还没有选择安装目录'
        }
        actions={
          <>
            {bases.length > 0 && (
              <button className="btn btn-sm" onClick={() => setShowBases((value) => !value)}>
                {showBases ? '隐藏原版基座' : `显示原版基座（${bases.length}）`}
              </button>
            )}
            <button className="btn btn-sm" onClick={onRefresh}>
              <IconRefresh />
              刷新
            </button>
            <button className="btn btn-sm btn-primary" onClick={onGoDownload}>
              安装新实例
            </button>
          </>
        }
      />
      <div className="page-split">
        <SideNav
          items={items}
          value={selected ?? ''}
          onChange={setSelected}
          emptyHint={
            <div className="side-empty">
              还没有实例。
              <br />
              先到「下载」页安装一个版本吧。
            </div>
          }
        />
        <div className="page-body">
          {!current ? (
            <div className="empty-page">
              <IconInstance />
              <h2>还没有已安装的实例</h2>
              <p>在「下载」页选择版本与加载器，安装完成后会出现在这里。</p>
              {bases.length > 0 && (
                <p className="muted">
                  另有 {bases.length} 个原版基座目录，可点右上角「显示原版基座」查看。
                </p>
              )}
              <button className="btn btn-primary" onClick={onGoDownload}>
                去下载页
              </button>
            </div>
          ) : (
            <>
              <div className="card instance-head">
                <div className="instance-title">{current.name}</div>
                <div className="instance-badges">
                  <span className="pill pill-idle">{current.mcVersion ?? '未知版本'}</span>
                  {current.managed ? (
                    <span className="badge badge-release">本工具安装</span>
                  ) : current.base ? (
                    <span className="badge badge-snapshot">原版基座</span>
                  ) : (
                    <span className="badge badge-old">外部实例</span>
                  )}
                  {current.isolation && <span className="badge badge-snapshot">版本隔离</span>}
                  {current.complete === false && <span className="badge badge-old">不完整</span>}
                  {current.installing && <span className="badge badge-snapshot">安装中</span>}
                </div>
                <span className="instance-path" title={current.path}>
                  {shortPath(current.path, 58)}
                </span>
              </div>

              <div className="card detail-card">
                <div className="detail-title">概览</div>
                <div className="info-grid">
                  <div className="info-cell">
                    <span className="info-label">Minecraft 版本</span>
                    <span className="info-value strong">{current.mcVersion ?? '—'}</span>
                  </div>
                  <div className="info-cell">
                    <span className="info-label">加载器</span>
                    <span className="info-value">{componentText(current.components)}</span>
                  </div>
                  <div className="info-cell">
                    <span className="info-label">安装时间</span>
                    <span className="info-value">{formatDate(current.installedAt)}</span>
                  </div>
                  <div className="info-cell">
                    <span className="info-label">文件 / 体积</span>
                    <span className="info-value">
                      {current.fileCount ? `${current.fileCount} 个文件` : '—'}
                      {current.totalBytes ? ` · ${formatBytes(current.totalBytes)}` : ''}
                    </span>
                  </div>
                  <div className="info-cell">
                    <span className="info-label">版本隔离</span>
                    <span className="info-value">
                      {current.isolation ? '开启（mods 在实例目录）' : '关闭（mods 在游戏根目录）'}
                    </span>
                  </div>
                  <div className="info-cell">
                    <span className="info-label">安装清单</span>
                    <span className="info-value">
                      {current.managed
                        ? current.complete === false
                          ? 'mineflux-install.json（不完整）'
                          : 'mineflux-install.json（完整）'
                        : current.base
                          ? '无（原版基座）'
                          : '无（外部创建的实例）'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="card detail-card">
                <div className="detail-title">操作</div>
                {current.base && (
                  <div className="inline-hint warn">
                    <IconAlert />
                    <span>
                      原版基座：加载器实例安装与「校验 / 补全」所需的原版版本目录，不是可独立启动的实例。
                      删除它不影响已装实例启动，但补全时会重新下载原版文件。
                    </span>
                  </div>
                )}
                {confirming === current.name && current.base && (
                  <div className="inline-hint warn">
                    <IconAlert />
                    <span>
                      确定删除基座「{current.name}」？相关加载器实例的「校验 / 补全」将重新下载约几十 MB
                      原版文件。
                    </span>
                  </div>
                )}
                <div className="action-row">
                  <button className="btn" onClick={() => onOpenDir(current.path)}>
                    <IconFolder />
                    打开实例目录
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={busy || Boolean(current.installing)}
                    onClick={() => onRepair(current)}
                  >
                    <IconRefresh />
                    校验 / 补全文件
                  </button>
                  <button className="btn" onClick={() => onOpenDir(root)}>
                    打开游戏目录
                  </button>
                  {confirming === current.name ? (
                    <>
                      <button
                        className="btn btn-primary danger-btn"
                        onClick={() => {
                          setConfirming(null)
                          onRemove(current)
                        }}
                      >
                        确认删除
                      </button>
                      <button className="btn btn-ghost" onClick={() => setConfirming(null)}>
                        取消
                      </button>
                    </>
                  ) : (
                    <button className="btn danger-btn" onClick={() => setConfirming(current.name)}>
                      <IconTrash />
                      {current.base ? '删除基座目录' : '删除实例'}
                    </button>
                  )}
                </div>
                {busy && (
                  <div className="inline-hint warn">
                    <IconAlert />
                    <span>当前有下载任务在进行，完成后再补全或删除实例。</span>
                  </div>
                )}
                <div className="settings-desc">
                  {current.base
                    ? `原版基座只包含原版文件（版本 JSON 与客户端 jar）。删除它只移除 versions/${current.name} 目录，已安装的加载器实例仍可正常启动。`
                    : `「校验 / 补全」会按安装清单重新比对所有文件，缺失或损坏的会重新下载，不会删除 mods 与存档。删除实例只移除 versions/${current.name} 目录。`}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

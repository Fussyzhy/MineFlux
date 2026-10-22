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

  useEffect(() => {
    setSelected((current) => {
      if (current && installed.some((item) => item.name === current)) return current
      return installed[0]?.name ?? null
    })
  }, [installed])

  const items = useMemo(
    () =>
      installed.map((item) => ({
        id: item.name,
        label: item.name,
        hint: [item.mcVersion ?? '未知版本', componentText(item.components)]
          .filter((part, index, list) => part && list.indexOf(part) === index)
          .join(' · '),
        icon: <IconInstance />,
        section: item.installing ? '安装中' : '已安装实例',
      })),
    [installed],
  )

  const current = installed.find((item) => item.name === selected) ?? null

  return (
    <div className="page">
      <PageHeader
        title="实例管理"
        subtitle={
          root
            ? `共 ${installed.length} 个实例 · ${shortPath(root, 52)}`
            : '还没有选择安装目录'
        }
        actions={
          <>
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
                          ? 'mcdl-install.json（不完整）'
                          : 'mcdl-install.json（完整）'
                        : '无（外部创建的实例）'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="card detail-card">
                <div className="detail-title">操作</div>
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
                      删除实例
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
                  「校验 / 补全」会按安装清单重新比对所有文件，缺失或损坏的会重新下载，不会删除
                  mods 与存档。删除实例只移除 versions/{current.name} 目录。
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

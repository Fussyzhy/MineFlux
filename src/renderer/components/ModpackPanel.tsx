import { useMemo, useRef } from 'react'
import type { ModpackInfo } from '../../shared/types'
import { formatBytes } from '../lib/format'
import { IconAlert, IconDownload, IconFolder } from './Icons'

const TYPE_LABELS: Record<ModpackInfo['type'], string> = {
  curseforge: 'CurseForge',
  modrinth: 'Modrinth',
  hmcl: 'HMCL',
  mmc: 'MultiMC / Prism',
  mcbbs: 'MCBBS',
  launcherpack: '启动器整合包',
  compress: '.minecraft 备份',
}

interface Props {
  info: ModpackInfo | null
  loading: boolean
  error: string | null
  busy: boolean
  instanceName: string
  isolation: boolean
  onPick: () => void
  onFile: (path: string) => void
  onInstanceName: (value: string) => void
  onIsolation: (value: boolean) => void
  onInstall: () => void
  onClear: () => void
}

function componentSummary(info: ModpackInfo): string {
  const parts: string[] = []
  const c = info.components
  if (c.fabric) parts.push(`Fabric ${c.fabric}`)
  if (c.quilt) parts.push(`Quilt ${c.quilt}`)
  if (c.forge) parts.push(`Forge ${c.forge}`)
  if (c.neoforge) parts.push(`NeoForge ${c.neoforge}`)
  if (c.liteloader) parts.push(`LiteLoader ${c.liteloader}`)
  if (c.optifine) parts.push(`OptiFine ${c.optifine}`)
  return parts.join(' · ')
}

export function ModpackPanel({
  info,
  loading,
  error,
  busy,
  instanceName,
  isolation,
  onPick,
  onFile,
  onInstanceName,
  onIsolation,
  onInstall,
  onClear,
}: Props) {
  const dragRef = useRef<HTMLDivElement>(null)
  const summary = useMemo(() => (info ? componentSummary(info) : ''), [info])
  const compressOnly = info?.type === 'compress'

  return (
    <div className="card modpack-card">
      <div className="card-title">安装整合包</div>
      <div
        ref={dragRef}
        className={`dropzone ${loading ? 'dropzone-busy' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          dragRef.current?.classList.add('dropzone-active')
        }}
        onDragLeave={() => dragRef.current?.classList.remove('dropzone-active')}
        onDrop={(event) => {
          event.preventDefault()
          dragRef.current?.classList.remove('dropzone-active')
          const files = Array.from(event.dataTransfer.files ?? [])
          const file = files[0]
          if (!file) return
          const path = window.mcdl.getPathForFile(file)
          if (path) onFile(path)
        }}
        onClick={() => !busy && void onPick()}
      >
        <IconFolder />
        <div className="dropzone-title">把整合包拖到这里</div>
        <div className="muted small">
          支持 CurseForge / Modrinth / HMCL / MultiMC / MCBBS / .minecraft 备份
        </div>
        <button className="btn btn-sm" disabled={busy} onClick={() => void onPick()}>
          选择文件
        </button>
      </div>

      {loading && <div className="inline-hint">正在解析整合包…</div>}
      {error && (
        <div className="inline-hint warn">
          <IconAlert />
          <span>{error}</span>
        </div>
      )}

      {info && (
        <div className="modpack-info">
          <div className="modpack-row">
            <span className="modpack-name" title={info.path}>
              {info.name || info.path}
            </span>
            <span className="badge badge-release">{TYPE_LABELS[info.type] ?? info.type}</span>
            {info.packVersion && <span className="muted small">v{info.packVersion}</span>}
          </div>
          <div className="modpack-meta">
            <span>
              Minecraft <b>{info.mcVersion ?? '未知'}</b>
            </span>
            {summary && <span>{summary}</span>}
            <span>{info.fileCount} 个文件</span>
            {info.totalBytes > 0 && <span>{formatBytes(info.totalBytes)}</span>}
          </div>
          {info.warnings.map((warning) => (
            <div className="inline-hint warn" key={warning}>
              <IconAlert />
              <span>{warning}</span>
            </div>
          ))}

          {!compressOnly && (
            <>
              <div className="install-grid">
                <label className="field">
                  <span>实例名称</span>
                  <input
                    value={instanceName}
                    spellCheck={false}
                    disabled={busy}
                    onChange={(event) => onInstanceName(event.target.value)}
                  />
                </label>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={isolation}
                    disabled={busy}
                    onChange={(event) => onIsolation(event.target.checked)}
                  />
                  <span>版本隔离（整合包的 mods 放进实例文件夹）</span>
                </label>
              </div>
            </>
          )}
          {compressOnly && (
            <div className="inline-hint warn">
              <IconAlert />
              <span>备份包会直接解压覆盖到游戏目录，同名文件将被替换</span>
            </div>
          )}

          <div className="install-actions">
            <button className="btn btn-primary" disabled={busy} onClick={onInstall}>
              <IconDownload />
              {busy ? '安装进行中…' : compressOnly ? '开始解压' : '开始安装整合包'}
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={onClear}>
              清除
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

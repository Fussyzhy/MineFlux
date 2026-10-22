import { useMemo, useState } from 'react'
import type { InstalledInstance, VersionSummary } from '../../shared/types'
import { formatDate } from '../lib/format'
import { IconSearch } from './Icons'

type Filter = 'release' | 'snapshot' | 'old' | 'all'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'release', label: '正式版' },
  { id: 'snapshot', label: '快照' },
  { id: 'old', label: '远古版' },
  { id: 'all', label: '全部' },
]

const TYPE_META: Record<string, { label: string; className: string }> = {
  release: { label: '正式', className: 'badge-release' },
  snapshot: { label: '快照', className: 'badge-snapshot' },
  old_beta: { label: 'β', className: 'badge-old' },
  old_alpha: { label: 'α', className: 'badge-old' },
}

interface Props {
  versions: VersionSummary[]
  loading: boolean
  error: string | null
  selectedId: string | null
  installed: Map<string, InstalledInstance[]>
  latestRelease?: string
  onSelect: (version: VersionSummary) => void
  onStart: (version: VersionSummary) => void
}

export function VersionList({
  versions,
  loading,
  error,
  selectedId,
  installed,
  latestRelease,
  onSelect,
  onStart,
}: Props) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('release')

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    const list = versions.filter((version) => {
      if (keyword) return version.id.toLowerCase().includes(keyword)
      if (filter === 'all') return true
      if (filter === 'old') {
        return version.type === 'old_beta' || version.type === 'old_alpha'
      }
      return version.type === filter
    })
    return list.slice(0, 500)
  }, [versions, search, filter])

  return (
    <div className="card version-card">
      <div className="search-box">
        <IconSearch />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索版本号，例如 1.20.1"
          spellCheck={false}
        />
      </div>
      <div className="chips">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            className={`chip ${filter === item.id && !search ? 'chip-active' : ''}`}
            onClick={() => {
              setFilter(item.id)
              setSearch('')
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="version-list">
        {loading && <div className="list-hint">正在获取版本清单…</div>}
        {error && !loading && <div className="list-hint error">{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="list-hint">没有匹配的版本</div>
        )}
        {filtered.map((version) => {
          const meta = TYPE_META[version.type] ?? { label: '未知', className: 'badge-old' }
          const installedList = installed.get(version.id) ?? []
          const installedTitle = installedList
            .map((item) => {
              const parts = [item.name]
              const c = item.components ?? {}
              if (c.fabric) parts.push(`Fabric ${c.fabric}`)
              if (c.quilt) parts.push(`Quilt ${c.quilt}`)
              if (c.forge) parts.push(`Forge ${c.forge}`)
              if (c.neoforge) parts.push(`NeoForge ${c.neoforge}`)
              if (c.liteloader) parts.push(`LiteLoader ${c.liteloader}`)
              if (c.optifine) parts.push(`OptiFine ${c.optifine}`)
              return parts.join(' · ')
            })
            .join('\n')
          return (
            <button
              key={version.id}
              className={`version-row ${selectedId === version.id ? 'version-row-active' : ''}`}
              data-version-row={version.id}
              onClick={() => onSelect(version)}
              onDoubleClick={() => onStart(version)}
              title="双击打开详细配置"
            >
              <span className="version-name">{version.id}</span>
              <span className={`badge ${meta.className}`}>{meta.label}</span>
              {version.id === latestRelease && <span className="badge badge-latest">最新</span>}
              {installedList.length > 0 && (
                <span className="badge badge-installed" title={installedTitle}>
                  {installedList.length > 1 ? `已安装 ${installedList.length}` : '已安装'}
                </span>
              )}
              <span className="version-date">{formatDate(version.releaseTime)}</span>
            </button>
          )
        })}
        {filtered.length === 500 && (
          <div className="list-hint">列表较长，仅显示前 500 个，请用搜索缩小范围</div>
        )}
      </div>

      <div className="version-footer">
        <span>共 {filtered.length} 个</span>
        <span className="muted">·</span>
        <span>{versions.length} 个可选版本</span>
      </div>
    </div>
  )
}

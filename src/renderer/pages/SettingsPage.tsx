import { useState } from 'react'
import type { JavaProbeResult, JavaReport, Settings, SourceMode } from '../../shared/types'
import type { SettingsTab } from '../lib/nav'
import { shortPath } from '../lib/format'
import { IconFolder, IconInfo, IconSettings } from '../components/Icons'
import { JavaSettingsPanel } from '../components/JavaSettingsPanel'
import { PageHeader } from '../components/PageHeader'
import { SideNav } from '../components/SideNav'

const SOURCE_ROWS: Array<{ value: SourceMode; title: string; desc: string }> = [
  {
    value: 'auto',
    title: '自动（镜像优先）',
    desc: '先尝试 BMCLAPI 镜像，镜像不可用时自动回退到官方源，通常速度最快。',
  },
  {
    value: 'official',
    title: '官方源优先',
    desc: '优先使用 Mojang / Fabric 等官方地址，失败后回退镜像。',
  },
  { value: 'mirror', title: '仅 BMCLAPI 镜像', desc: '只使用镜像 CDN，适合官方源访问不稳定的网络。' },
]

const TABS = [
  { id: 'download', label: '下载', icon: <IconSettings /> },
  { id: 'modpack', label: '整合包', icon: <IconFolder /> },
  { id: 'java', label: 'Java', icon: <IconInfo /> },
]

interface Props {
  settings: Settings
  javaReport: JavaReport | null
  appVersion: string
  busy: boolean
  onSettings: (patch: Partial<Settings>) => void
  onPickFolder: () => void
  onDetectJava: () => void
  onReveal: (target: string) => void
  /** 手动指定 Java：浏览文件 / 保存并重新检测 / 校验路径 / 打开下载页 */
  onPickJavaFile: () => void
  onJavaSettings: (patch: Partial<Settings>) => void
  onProbeJavaPath: (target: string) => Promise<JavaProbeResult | null>
  onOpenJavaDownload: () => void
}

/** 设置页（PCL 的「设置」）：左栏分类 + 右侧设置卡片 */
export function SettingsPage({
  settings,
  javaReport,
  appVersion,
  busy,
  onSettings,
  onPickFolder,
  onDetectJava,
  onReveal,
  onPickJavaFile,
  onJavaSettings,
  onProbeJavaPath,
  onOpenJavaDownload,
}: Props) {
  const [tab, setTab] = useState<SettingsTab>('download')

  return (
    <div className="page">
      <PageHeader
        title="设置"
        subtitle="下载源、并发、校验与 Java 环境；修改会立即保存"
        actions={<span className="muted small">v{appVersion}</span>}
      />
      <div className="page-split">
        <SideNav items={TABS} value={tab} onChange={(id) => setTab(id as SettingsTab)} />
        <div className="page-body">
          {tab === 'download' && (
            <>
              <div className="card settings-card">
                <div className="settings-title">下载源</div>
                <div className="settings-desc">
                  原版清单来自 Mojang piston-meta，镜像使用 BMCLAPI；加载器分别使用 Fabric /
                  Quilt / Forge / NeoForge / OptiFine 的官方接口与镜像。
                </div>
                <div className="settings-grid" style={{ gridTemplateColumns: '1fr' }}>
                  {SOURCE_ROWS.map((row) => (
                    <label
                      key={row.value}
                      className={`radio-row ${settings.mode === row.value ? 'active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="source-mode"
                        checked={settings.mode === row.value}
                        disabled={busy}
                        onChange={() => onSettings({ mode: row.value })}
                      />
                      <span className="radio-row-text">
                        <span className="radio-row-title">{row.title}</span>
                        <span className="radio-row-desc">{row.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="card settings-card">
                <div className="settings-title">下载与校验</div>
                <div className="settings-grid">
                  <label className="field">
                    <span>并发连接数（1–64）</span>
                    <input
                      type="number"
                      min={1}
                      max={64}
                      value={settings.concurrency}
                      disabled={busy}
                      onChange={(event) =>
                        onSettings({
                          concurrency: Math.max(1, Math.min(64, Number(event.target.value) || 1)),
                        })
                      }
                    />
                  </label>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={settings.verifyHashes}
                      disabled={busy}
                      onChange={(event) => onSettings({ verifyHashes: event.target.checked })}
                    />
                    <span>校验已存在文件的 SHA1</span>
                  </label>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={settings.isolation}
                      onChange={(event) => onSettings({ isolation: event.target.checked })}
                    />
                    <span>新实例默认开启版本隔离</span>
                  </label>
                </div>
                <div className="settings-desc">
                  开启 SHA1 校验后，重复安装会重新计算已有文件的哈希并只补下缺失 / 损坏的文件。
                </div>
              </div>

              <div className="card settings-card">
                <div className="settings-title">安装目录</div>
                <div className="target-path" title={settings.root}>
                  {settings.root ? shortPath(settings.root, 72) : '（未设置）'}
                </div>
                <div className="action-row">
                  <button className="btn btn-sm" onClick={onPickFolder}>
                    <IconFolder />
                    浏览
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={!settings.root}
                    onClick={() => onReveal(settings.root)}
                  >
                    打开
                  </button>
                  <span className="muted small">
                    推荐指向 Minecraft 启动器的游戏目录（.minecraft）
                  </span>
                </div>
              </div>
            </>
          )}

          {tab === 'modpack' && (
            <>
              <div className="card settings-card">
                <div className="settings-title">CurseForge API Key</div>
                <div className="settings-desc">
                  下载 CurseForge 整合包里的文件需要官方 API Key（免费申请）。留空时会尝试镜像接口。
                  也可以设置环境变量 MINEFLUX_CURSEFORGE_API_KEY。
                </div>
                <label className="field">
                  <span>API Key</span>
                  <input
                    type="password"
                    value={settings.curseforgeApiKey}
                    placeholder="可选，留空则使用镜像接口"
                    spellCheck={false}
                    onChange={(event) => onSettings({ curseforgeApiKey: event.target.value })}
                  />
                </label>
              </div>
              <div className="card settings-card">
                <div className="settings-title">支持的整合包格式</div>
                <div className="source-list">
                  <span>CurseForge（manifest.json）</span>
                  <span>Modrinth（.mrpack）</span>
                  <span>HMCL</span>
                  <span>MultiMC / Prism</span>
                  <span>MCBBS</span>
                  <span>启动器嵌套包</span>
                  <span>.minecraft 备份压缩包</span>
                  <span>zip / mrpack / 无扩展名（按内容识别）</span>
                </div>
                <div className="settings-desc">
                  RAR 暂不支持。整合包安装时会把 overrides 里的 mods、config 等还原到实例目录。
                </div>
              </div>
            </>
          )}

          {tab === 'java' && (
            <JavaSettingsPanel
              settings={settings}
              javaReport={javaReport}
              busy={busy}
              onJavaSettings={onJavaSettings}
              onDetectJava={onDetectJava}
              onPickJavaFile={onPickJavaFile}
              onProbeJavaPath={onProbeJavaPath}
              onOpenJavaDownload={onOpenJavaDownload}
              onReveal={onReveal}
            />
          )}
        </div>
      </div>
    </div>
  )
}

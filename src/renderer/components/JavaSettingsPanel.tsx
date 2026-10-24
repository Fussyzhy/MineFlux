import { useEffect, useState } from 'react'
import type { JavaProbeResult, JavaReport, Settings } from '../../shared/types'
import { shortPath } from '../lib/format'
import { IconCheck, IconFolder, IconInfo, IconRefresh } from './Icons'

interface Props {
  settings: Settings
  javaReport: JavaReport | null
  busy: boolean
  /** 手动 Java 路径的本地草稿：失焦 / 回车时才保存，避免边打字边探测 */
  onJavaSettings: (patch: Partial<Settings>) => void
  onDetectJava: () => void
  onPickJavaFile: () => void
  onProbeJavaPath: (target: string) => Promise<JavaProbeResult | null>
  onOpenJavaDownload: () => void
  onReveal: (target: string) => void
}

/** 两个路径是否指向同一个 Java（只比较字符串，用于避免重复保存） */
function sameExecutable(a: string, b: string): boolean {
  const left = a.trim().replace(/^"(.*)"$/, '$1').replace(/[\\/]+$/, '').toLowerCase()
  const right = b.trim().replace(/^"(.*)"$/, '$1').replace(/[\\/]+$/, '').toLowerCase()
  return left === right
}

/**
 * 设置页「Java」分类：
 * 顶部是手动指定的 Java（PCL 的「设置 → 启动 → Java 设置」），下面是自动检测结果。
 */
export function JavaSettingsPanel({
  settings,
  javaReport,
  busy,
  onJavaSettings,
  onDetectJava,
  onPickJavaFile,
  onProbeJavaPath,
  onOpenJavaDownload,
  onReveal,
}: Props) {
  const [draft, setDraft] = useState(settings.javaPath)
  const [checking, setChecking] = useState(false)
  const [probe, setProbe] = useState<JavaProbeResult | null>(null)

  // 设置被其它入口（浏览文件 / 清除）改动时同步到输入框
  useEffect(() => {
    setDraft(settings.javaPath)
    setProbe(null)
  }, [settings.javaPath])

  /** 校验并保存：路径没变时只重新校验，不重复写设置 */
  const commit = async (value: string): Promise<void> => {
    const next = value.trim()
    const unchanged = sameExecutable(next, settings.javaPath)
    if (!unchanged) onJavaSettings({ javaPath: next })
    if (!next) {
      setProbe(null)
      return
    }
    setChecking(true)
    setProbe(await onProbeJavaPath(next))
    setChecking(false)
  }

  const selectedPath = javaReport?.selected ?? ''
  const manualValid = Boolean(javaReport?.manualPath) && !javaReport?.manualError
  const manualFile = javaReport?.versions.find((item) => item.manual)?.path ?? ''
  // 生效项是否就是手动指定的 java.exe（两者都是解析后的 exe 路径，直接比较即可）
  const isManualEffective =
    Boolean(manualFile) && selectedPath.toLowerCase() === manualFile.toLowerCase()

  return (
    <>
      <div className="card settings-card">
        <div className="settings-title">手动指定 Java</div>
        <div className="settings-desc">
          自动检测找不到 Java、或希望固定使用某个版本（例如某些 Forge 安装器必须用 Java 8）时，
          在这里直接指定 java.exe；安装器运行时会优先使用它。
        </div>
        <div className="field java-path-field">
          <span>Java 路径</span>
          <input
            value={draft}
            placeholder="例如 C:\\Program Files\\Java\\jdk-21 或 …\\bin\\java.exe"
            spellCheck={false}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit(draft)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void commit(draft)
            }}
          />
        </div>
        <div className="action-row">
          <button className="btn btn-sm" disabled={busy} onClick={onPickJavaFile}>
            <IconFolder />
            浏览…
          </button>
          <button
            className="btn btn-sm"
            disabled={busy || checking || !draft.trim()}
            onClick={() => void commit(draft)}
          >
            <IconCheck />
            {checking ? '校验中…' : '校验并保存'}
          </button>
          <button
            className="btn btn-sm"
            disabled={busy || !settings.javaPath}
            onClick={() => void commit('')}
          >
            清除
          </button>
          {settings.javaPath && !busy && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => onReveal(settings.javaPath)}
            >
              打开位置
            </button>
          )}
        </div>

        {probe && !probe.ok && (
          <div className="inline-hint warn">
            <IconInfo />
            <span>{probe.error ?? '该路径不是有效的 Java'}</span>
          </div>
        )}
        {probe?.ok && (
          <div className="inline-hint">
            <IconCheck />
            <span>
              校验通过：Java {probe.version}（Java {probe.major}）· {probe.path}
            </span>
          </div>
        )}
        {!probe && javaReport?.manualError && (
          <div className="inline-hint warn">
            <IconInfo />
            <span>{javaReport.manualError}</span>
          </div>
        )}

        <label className="switch java-prefer">
          <input
            type="checkbox"
            checked={settings.javaPreferManual}
            disabled={busy}
            onChange={(event) => onJavaSettings({ javaPreferManual: event.target.checked })}
          />
          <span>优先使用手动指定的 Java（自动检测也找到时）</span>
        </label>
        {settings.javaPath && !settings.javaPreferManual && (
          <div className="settings-desc">
            已关闭：与自动检测的结果条件相同时才会优先使用手动指定的 Java。
          </div>
        )}
        {settings.javaPath && !manualValid && !probe && !javaReport?.manualError && (
          <div className="settings-desc">正在校验手动指定的 Java…</div>
        )}
      </div>

      <div className="card settings-card">
        <div className="settings-title">自动检测</div>
        <div className="settings-desc">
          Forge 1.13+ / NeoForge / OptiFine 1.14+ 的官方安装器需要本机 Java 才能运行；
          原版下载与 Fabric / Quilt / LiteLoader / OptiFine 1.13.2 及以下不需要。
        </div>
        <div className="action-row">
          <button className="btn btn-sm" disabled={busy} onClick={onDetectJava}>
            <IconRefresh />
            重新检测
          </button>
          <span className={`java-badge ${javaReport && javaReport.found === 0 ? 'java-badge-warn' : ''}`}>
            {javaReport
              ? javaReport.found
                ? `检测到 ${javaReport.found} 个 Java`
                : '未检测到 Java'
              : '检测中…'}
          </span>
          <span className="muted small">没有 Java？</span>
          <button className="btn btn-sm btn-ghost" onClick={onOpenJavaDownload}>
            下载 Java（Adoptium）
          </button>
        </div>

        {selectedPath && (
          <div className="inline-hint" data-java-effective>
            <IconCheck />
            <span>
              当前生效：{shortPath(selectedPath, 56)}
              {isManualEffective ? '（手动指定）' : '（自动检测）'}
            </span>
          </div>
        )}

        {javaReport?.versions.length ? (
          <div className="java-list" data-java-list>
            {javaReport.versions.map((item) => (
              <div className="java-item" key={item.path}>
                <span className="java-item-path" title={item.path}>
                  {item.path}
                </span>
                <span className="java-item-tags">
                  {item.manual && <span className="java-item-badge">手动</span>}
                  {item.path === selectedPath && <span className="java-item-badge active">生效</span>}
                  <span className="java-item-tag">
                    Java {item.major} · {item.version}
                    {item.source && !item.manual ? ` · ${item.source}` : ''}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="inline-hint warn">
            <IconInfo />
            <span>
              {javaReport?.note ??
                '未检测到 Java：Forge 1.13+ / NeoForge / OptiFine 1.14+ 需要 Java 才能安装'}
            </span>
          </div>
        )}
      </div>

      <div className="card settings-card">
        <div className="settings-title">安装建议</div>
        <div className="settings-desc">
          当前环境没有 Java 也不影响原版、Fabric、Quilt、LiteLoader 与 OptiFine
          旧版的安装；需要 Java 的安装器会在开始前直接给出明确提示。
          手动指定的路径会写入设置文件，下次启动继续生效。
        </div>
      </div>
    </>
  )
}

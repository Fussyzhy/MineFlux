import type { JavaReport } from '../../shared/types'
import { PageHeader } from '../components/PageHeader'

interface Props {
  appVersion: string
  javaReport: JavaReport | null
  onOpenExternal: (url: string) => void
}

const SOURCES = [
  'Mojang piston-meta（版本清单）',
  'BMCLAPI（镜像 CDN）',
  'Fabric / Quilt Meta',
  'Forge / NeoForge maven',
  'OptiFine / LiteLoader 官方',
  'Modrinth API',
  'CurseForge API（需 Key）',
]

/** 关于页：许可、边界、数据源与参考实现 */
export function AboutPage({ appVersion, javaReport, onOpenExternal }: Props) {
  return (
    <div className="page">
      <PageHeader title="关于" subtitle="工具说明、数据来源与开源许可" />
      <div className="page-body">
        <div className="card about-hero">
          <div className="about-logo">MC</div>
          <div>
            <div className="about-name">MC Downloader</div>
            <div className="about-tagline">
              独立 Minecraft 下载 / 安装工具 · v{appVersion} · 第三方非官方项目
            </div>
          </div>
        </div>

        <div className="card about-card">
          <h3>这是什么</h3>
          <div className="about-line">
            <span>
              只负责「下载与安装」的独立 GUI 工具：下载原版 Minecraft、合并模组加载器、安装整合包，
              支持 SHA1 校验、失败重试、断点续传与实例隔离。不包含启动器与登录功能。
            </span>
          </div>
          <div className="about-line">
            <span>
              安装逻辑参考了{' '}
              <button
                className="link-btn"
                onClick={() => onOpenExternal('https://github.com/Meloong-Git/PCL')}
              >
                Plain Craft Launcher 2
              </button>{' '}
              的公开实现（MergeJson、McInstallLoadersGet、ModModpack、PathIndie
              等），版本 JSON 合并顺序与 PCL 保持一致；本项目是独立实现，不包含 PCL
              的二进制或资源文件。
            </span>
          </div>
        </div>

        <div className="card about-card">
          <h3>功能边界</h3>
          <div className="about-line">
            <b>不提供：</b>
            <span>启动游戏、登录微软 / 第三方账户、DRM、跳过验证。</span>
          </div>
          <div className="about-line">
            <b>不包含：</b>
            <span>游戏本体、资源文件、模组；所有文件均从官方或镜像 CDN 下载。</span>
          </div>
          <div className="about-line">
            <b>文件位置：</b>
            <span>全部写入你选择的游戏目录，兼容 PCL / HMCL / 官方启动器的 versions 目录结构。</span>
          </div>
          <div className="about-line">
            <b>Java 环境：</b>
            <span>
              {javaReport
                ? javaReport.found
                  ? `已检测到 ${javaReport.found} 个 Java`
                  : '当前未检测到 Java'
                : '检测中…'}
              ，仅 Forge 1.13+ / NeoForge / OptiFine 1.14+ 安装器需要。
            </span>
          </div>
        </div>

        <div className="card about-card">
          <h3>数据来源</h3>
          <div className="source-list">
            {SOURCES.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <div className="about-line">
            <span>下载源可在「设置 → 下载」切换：自动（镜像优先）/ 官方源优先 / 仅 BMCLAPI 镜像。</span>
          </div>
        </div>

        <div className="card about-card">
          <h3>开源许可</h3>
          <div className="about-line">
            <b>MIT：</b>
            <span>本项目代码以 MIT 许可发布，详见仓库 LICENSE 文件。</span>
          </div>
          <div className="about-line">
            <b>第三方：</b>
            <span>
              名称与图标不包含 Minecraft / Mojang / PCL 的商标素材；Minecraft 是 Mojang Studios
              的商标，本项目与 Mojang 无关。
            </span>
          </div>
          <div className="about-line">
            <b>反馈：</b>
            <span>安装失败时请把「任务」页的日志一并附上（不包含账号等敏感信息）。</span>
          </div>
        </div>
      </div>
    </div>
  )
}

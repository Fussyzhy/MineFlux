/**
 * 主进程 <-> 渲染进程 的共享契约。
 * 这个文件必须保持「零依赖」，因为它会被两边同时引用。
 */

/** 下载源策略：auto = 镜像优先（PCL 默认），official = 官方优先，mirror = 仅镜像 */
export type SourceMode = 'auto' | 'official' | 'mirror'

export type SourceName = 'mojang' | 'bmclapi'

export interface VersionSummary {
  id: string
  /** release / snapshot / old_beta / old_alpha */
  type: string
  /** 该版本 json 的原始下载地址 */
  url: string
  releaseTime: string
  /** version_manifest_v2 提供的版本 json 校验值（部分镜像不提供） */
  sha1?: string
  complianceLevel?: number
}

export interface VersionListResult {
  source: SourceName
  sourceLabel: string
  fetchedAt: number
  latest: { release?: string; snapshot?: string }
  versions: VersionSummary[]
}

export type FileKind =
  | 'versionJson'
  | 'client'
  | 'library'
  | 'assetIndex'
  | 'asset'
  | 'logging'
  | 'loader'
  | 'mod'
  | 'override'

export type StageId = FileKind

export interface StageProgress {
  id: StageId
  label: string
  totalBytes: number
  doneBytes: number
  totalFiles: number
  doneFiles: number
}

export type TaskState = 'running' | 'paused' | 'finished' | 'failed' | 'canceled'

export interface FileFailure {
  path: string
  kind: FileKind
  error: string
  urls: string[]
}

export interface TaskSnapshot {
  taskId: string
  kind: InstallKind
  versionId: string
  instanceName: string
  root: string
  state: TaskState
  /** 当前正在做的事（人类可读） */
  message: string
  totalBytes: number
  doneBytes: number
  totalFiles: number
  doneFiles: number
  /** bytes / second */
  speed: number
  /** 剩余秒数，-1 表示未知 */
  etaSeconds: number
  stages: StageProgress[]
  failures: FileFailure[]
  startedAt: number
  finishedAt: number | null
}

export interface LogLine {
  time: number
  level: 'info' | 'warn' | 'error' | 'debug'
  text: string
}

export type TaskEvent =
  | { type: 'snapshot'; snapshot: TaskSnapshot }
  | { type: 'log'; taskId: string; line: LogLine }

export type InstallKind = 'version' | 'modpack'

export type LoaderId = 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'liteloader' | 'optifine'

/** 每个加载器最多选一个版本；fabric/quilt 与 forge/neoforge 互斥 */
export interface LoaderSelection {
  fabric?: string
  quilt?: string
  forge?: string
  neoforge?: string
  liteloader?: string
  optifine?: string
}

export interface InstallComponents extends LoaderSelection {
  /** 是否自动安装 Fabric API（Fabric/Quilt 时可选） */
  fabricApi?: boolean
  /** 是否自动安装 OptiFabric（Fabric + OptiFine 时可选） */
  optifabric?: boolean
}

export type ModpackType =
  | 'curseforge'
  | 'modrinth'
  | 'hmcl'
  | 'mmc'
  | 'mcbbs'
  | 'launcherpack'
  | 'compress'

export interface ModpackInfo {
  path: string
  type: ModpackType
  name: string
  packVersion?: string
  /** 整合包声明的依赖 */
  components: InstallComponents
  /** 整合包基于的 Minecraft 版本 */
  mcVersion?: string
  fileCount: number
  totalBytes: number
  warnings: string[]
  /** compress 类型没有可安装的版本信息，只能解压 */
  requiresJava?: boolean
}

export interface InstallRequest {
  kind: InstallKind
  /** 目标 Minecraft 版本（modpack 时由整合包决定，可为空） */
  versionId: string
  versionUrl?: string
  /** 期望的版本 json sha1，可为空 */
  versionSha1?: string
  root: string
  /** 实例名（= versions/<name>） */
  instanceName: string
  mode: SourceMode
  concurrency: number
  /** 是否对已存在文件做完整 SHA1 校验（关闭时只比对大小，更快） */
  verifyHashes: boolean
  /** 版本清单实际来自哪个源；用于 auto 模式下判断镜像是否可用 */
  manifestSource?: SourceName
  components?: InstallComponents
  /** 版本隔离：mods / resourcepacks 放在实例文件夹里（PCL 的「版本隔离」） */
  isolation: boolean
  /** 允许覆盖已存在的同名实例 */
  overwrite?: boolean
  /** 整合包安装时使用 */
  modpack?: ModpackInfo
  /** CurseForge API Key（整合包/模组解析用） */
  curseforgeApiKey?: string
}

export interface Settings {
  root: string
  mode: SourceMode
  concurrency: number
  verifyHashes: boolean
  /** 新建实例时默认开启版本隔离 */
  isolation: boolean
  curseforgeApiKey: string
}

export interface LoaderVersionItem {
  version: string
  label: string
  stable?: boolean
  recommended?: boolean
  releaseTime?: string
}

export interface LoaderVersionList {
  id: LoaderId
  label: string
  versions: LoaderVersionItem[]
  source: string
  note?: string
  requiresJava?: boolean
}

/** 以 Mod 形式安装的资源（Fabric API / OptiFabric）的版本信息 */
export interface ModVersionInfo {
  version: string
  filename: string
  releaseTime?: string
}

export interface ModVersionList {
  versions: ModVersionInfo[]
  source: string
}

export interface InstalledInstance {
  name: string
  /** 实例目录绝对路径 */
  path: string
  mcVersion?: string
  components: InstallComponents
  installedAt?: number
  /** 实例文件夹里是否有 mcdl-install.json（否则是外部创建的实例） */
  managed: boolean
  /** 来自安装清单：是否版本隔离 */
  isolation?: boolean
  /** 来自安装清单：上次安装是否完整 */
  complete?: boolean
  fileCount?: number
  totalBytes?: number
  /** 是否正在安装（存在 .pclignore） */
  installing?: boolean
}

export type WindowAction = 'minimize' | 'maximize' | 'close'

export interface WindowStateEvent {
  maximized: boolean
}

export interface JavaReport {
  found: number
  versions: { path: string; major: number; version: string }[]
  note?: string
}

export interface McdlApi {
  getVersions(mode: SourceMode): Promise<VersionListResult>
  startInstall(req: InstallRequest): Promise<{ taskId: string }>
  pause(taskId: string): Promise<void>
  resume(taskId: string): Promise<void>
  cancel(taskId: string): Promise<void>
  retryFailed(taskId: string): Promise<void>
  chooseFolder(): Promise<string | null>
  chooseModpackFile(): Promise<string | null>
  inspectModpack(file: string): Promise<ModpackInfo>
  revealPath(target: string): Promise<void>
  openExternal(url: string): Promise<void>
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>
  suggestRoot(): Promise<string>
  getLoaderVersions(id: LoaderId, mcVersion: string, mode: SourceMode): Promise<LoaderVersionList>
  /** Fabric API / OptiFabric 这类「作为 Mod 安装」的资源版本列表 */
  getModVersions(
    slug: 'fabric-api' | 'optifabric',
    mcVersion: string,
    loaders: string[],
    mode: SourceMode,
  ): Promise<ModVersionList>
  detectJava(): Promise<JavaReport>
  /** 拖拽文件的绝对路径（Electron webUtils） */
  getPathForFile(file: File): string
  /** 目标目录中已安装的实例（依据 versions/<id>/<id>.json 判断） */
  getInstalledVersions(root: string): Promise<InstalledInstance[]>
  /** 删除某个实例（versions/<name>），不影响其它实例 */
  removeInstance(root: string, name: string): Promise<void>
  /** 自定义标题栏的窗口控制按钮 */
  windowControl(action: WindowAction): Promise<boolean>
  /** 订阅窗口最大化状态变化 */
  onWindowState(cb: (state: WindowStateEvent) => void): () => void
  onEvent(cb: (event: TaskEvent) => void): () => void
  appVersion(): Promise<string>
}


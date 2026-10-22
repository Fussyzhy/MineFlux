import os from 'node:os'
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import type {
  FileKind,
  FileFailure,
  InstallRequest,
  LogLine,
  SourceMode,
  StageId,
  StageProgress,
  TaskSnapshot,
  TaskState,
} from '../shared/types'
import { DownloadEngine, sha1File, type RunResult } from './downloader'
import { errorText, getTextFromSources } from './http'
import { describeSource, metaUrls } from './mirror'
import { detectRuleContext } from './rules'
import {
  buildAssetPlan,
  buildBasePlan,
  type AssetIndexJson,
  type BasePlan,
  type PlannedFile,
} from './version'
import {
  mergeVersionJson,
  normalizeInstanceJson,
  type RawVersion,
} from './version-json'
import { LOADER_LABELS, prepareLoader, type LoaderContext } from './loaders'
import { optiFineUrls, splitOptiFineVersion } from './loaders/optifine'
import { resolveModrinthMod } from './loaders/resources'
import { pickJava, runJava } from './java'
import {
  dataDirOf,
  ensureDataDirs,
  instanceDir,
  instanceJsonPath,
  instanceJarPath,
  isInstalling,
  markInstalling,
  sanitizeInstanceName,
  unmarkInstalling,
  writeManifest,
} from './instance'
import { ensureModpackDirs, installModpack } from './modpack'
import { writeFileAtomic } from './fsutil'

/** 阶段顺序与展示名（对应 PCL 的安装 LoaderTask 列表） */
const STAGE_ORDER: StageId[] = [
  'versionJson',
  'client',
  'library',
  'loader',
  'assetIndex',
  'asset',
  'logging',
  'mod',
  'override',
]
const STAGE_LABELS: Record<StageId, string> = {
  versionJson: '版本信息',
  client: '客户端 jar',
  library: '依赖库',
  loader: '安装器',
  assetIndex: '资源索引',
  asset: '资源文件',
  logging: '日志配置',
  mod: '模组文件',
  override: '覆盖文件',
}

type Phase = 'init' | 'base' | 'loaders' | 'assets' | 'instance' | 'extract' | 'done'

export interface TaskHooks {
  emitSnapshot: (snapshot: TaskSnapshot) => void
  emitLog: (line: LogLine) => void
}

export class InstallTask {
  readonly id: string
  private state: TaskState = 'running'
  private phase: Phase = 'init'
  private basePlan: BasePlan | null = null
  private finalPlan: BasePlan | null = null
  private vanillaRaw: RawVersion | null = null
  private instanceName: string
  private readonly tempDir: string

  /** 已登记过的目标路径，避免重复计数 */
  private plannedDests = new Set<string>()
  private completed = new Set<string>()
  private fileBytes = new Map<string, number>()
  private stageStats = new Map<StageId, StageStats>()
  private failures: FileFailure[] = []
  private baseQueue: PlannedFile[] = []
  private loaderQueue: PlannedFile[] = []
  private assetQueue: PlannedFile[] = []
  private modQueue: PlannedFile[] = []
  private pendingQueue: PlannedFile[] | null = null
  private doneBytes = 0
  private totalBytes = 0
  private doneFiles = 0
  private totalFiles = 0
  private speed = 0
  private lastSpeedBytes = 0
  private lastSpeedAt = Date.now()
  private message = '准备中'
  private readonly startedAt = Date.now()
  private finishedAt: number | null = null
  private retrying = false

  private readonly engine: DownloadEngine
  private fetchAbort = new AbortController()
  private advancing = false
  private advanceRequested = 0
  private tickTimer: NodeJS.Timeout | null = null
  /** auto 模式下根据版本清单实际来源确定的下载源策略 */
  private readonly mode: SourceMode

  constructor(
    private readonly request: InstallRequest,
    private readonly hooks: TaskHooks,
  ) {
    this.id = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    this.mode =
      request.mode === 'auto' && request.manifestSource === 'mojang' ? 'official' : request.mode
    this.instanceName = sanitizeInstanceName(request.instanceName || request.versionId)
    this.tempDir = path.join(os.tmpdir(), 'mcdl-temp', this.id)
    this.engine = new DownloadEngine({
      concurrency: Math.max(1, Math.min(64, request.concurrency || 24)),
      verifyHashes: request.verifyHashes,
      log: (level, text) => this.log(level, text),
      onFileStart: (file) => this.handleFileStart(file),
      onBytes: (file, delta) => this.handleBytes(file, delta),
      onFileDone: (file) => this.handleFileDone(file),
      onFileSkip: (file) => this.handleFileSkip(file),
      onFileFail: (file, error) => this.log('warn', `失败：${this.shortPath(file.dest)} — ${error}`),
    })
  }

  // ------------------------------------------------------------------ 生命周期

  async start(): Promise<void> {
    this.startTicker()
    const target = this.request.kind === 'modpack' ? '整合包' : `版本 ${this.request.versionId}`
    this.log('info', `开始安装${target} 到 ${this.request.root}`)
    this.log(
      'info',
      `下载源策略：${describeSource(this.mode)}${this.mode !== this.request.mode ? '（检测到镜像不可用，已自动切换到官方源）' : ''}`,
    )
    if (this.request.kind === 'version' && this.instanceName !== this.request.versionId) {
      this.log('info', `实例名称：${this.instanceName}`)
    }
    await this.advance()
  }

  pause(): void {
    if (this.state !== 'running') return
    this.state = 'paused'
    this.fetchAbort.abort()
    this.engine.abort()
    this.stopTicker()
    this.log('info', '已暂停')
    this.emit()
  }

  resume(): void {
    if (this.state !== 'paused') return
    this.state = 'running'
    this.fetchAbort = new AbortController()
    this.startTicker()
    this.log('info', '继续下载')
    void this.advance()
  }

  cancel(): void {
    if (this.state === 'finished' || this.state === 'canceled') return
    this.state = 'canceled'
    this.fetchAbort.abort()
    this.engine.abort()
    this.stopTicker()
    this.finishedAt = Date.now()
    void DownloadEngine.cleanupParts(this.allFiles())
    void fsp.rm(this.tempDir, { recursive: true, force: true })
    this.log('warn', '已取消下载（已完成分片保留，未完成的临时文件已清理）')
    this.emit()
  }

  retryFailed(): void {
    this.log('info', '重新校验并补全缺失文件（已完成的文件会自动跳过）')
    this.retrying = true
    this.failures = []
    this.resetProgress()
    this.phase = 'init'
    this.basePlan = null
    this.finalPlan = null
    this.vanillaRaw = null
    this.baseQueue = []
    this.loaderQueue = []
    this.assetQueue = []
    this.modQueue = []
    this.pendingQueue = null
    this.state = 'running'
    this.finishedAt = null
    this.fetchAbort = new AbortController()
    this.startTicker()
    this.emit()
    void this.advance()
  }

  getSnapshot(): TaskSnapshot {
    return {
      taskId: this.id,
      kind: this.request.kind,
      versionId: this.request.versionId,
      instanceName: this.instanceName,
      root: this.request.root,
      state: this.state,
      message: this.message,
      totalBytes: this.totalBytes,
      doneBytes: this.doneBytes,
      totalFiles: this.totalFiles,
      doneFiles: this.doneFiles,
      speed: this.speed,
      etaSeconds: this.eta(),
      stages: STAGE_ORDER.map((id) => this.stageStats.get(id)).filter(
        (stage): stage is StageStats => Boolean(stage),
      ),
      failures: this.failures,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    }
  }

  // ------------------------------------------------------------------ 主流程

  private async advance(): Promise<void> {
    this.advanceRequested++
    if (this.advancing) return
    this.advancing = true
    try {
      do {
        const requested = this.advanceRequested
        await this.advanceOnce()
        if (this.advanceRequested === requested || this.state !== 'running') break
      } while (this.state === 'running')
    } catch (error) {
      if (this.state !== 'running') return
      this.state = 'failed'
      this.finishedAt = Date.now()
      this.failures.push({
        path: this.request.root,
        kind: 'versionJson',
        error: errorText(error),
        urls: [],
      })
      this.log('error', `任务失败：${errorText(error)}`)
      this.stopTicker()
      this.emit()
    } finally {
      this.advancing = false
    }
  }

  private async advanceOnce(): Promise<void> {
    if (this.state !== 'running') return
    try {
      if (this.phase === 'init') {
        this.message = '获取版本信息'
        this.emit()
        await this.phaseInit()
      }
      if (this.state === 'running' && this.phase === 'extract') {
        await this.phaseExtract()
      }
      if (this.state === 'running' && this.phase === 'base') {
        const paused = await this.runQueue(this.baseQueue, '下载客户端与依赖库')
        if (paused) return
        this.phase = 'loaders'
      }
      if (this.state === 'running' && this.phase === 'loaders') {
        await this.phaseLoaders()
      }
      if (this.state === 'running' && this.phase === 'assets') {
        await this.phaseAssets()
      }
      if (this.state === 'running' && this.phase === 'instance') {
        await this.phaseInstance()
      }
      if (this.state === 'running' && this.phase === 'done') {
        this.finish()
      }
    } catch (error) {
      if (this.state !== 'running') return
      throw error
    }
  }

  // ------------------------------------------------------------------ 各阶段

  private async phaseInit(): Promise<void> {
    await fsp.mkdir(this.tempDir, { recursive: true })
    const root = path.resolve(this.request.root)
    const ctx = detectRuleContext()
    this.ruleContext = ctx

    // 纯解压类整合包没有版本信息
    if (this.request.modpack?.type === 'compress') {
      this.phase = 'extract'
      return
    }
    if (!this.request.versionUrl) throw new Error('缺少 Minecraft 版本下载地址')

    const result = await getTextFromSources(metaUrls(this.request.versionUrl, this.mode), {
      signal: this.fetchAbort.signal,
      timeoutMs: 30_000,
    })
    const text = result.data
    if (this.request.versionSha1) {
      const actual = crypto.createHash('sha1').update(text, 'utf8').digest('hex')
      if (actual !== this.request.versionSha1.toLowerCase()) {
        throw new Error(`版本 json 校验失败（期望 ${this.request.versionSha1}，实际 ${actual}）`)
      }
    }
    let raw: RawVersion
    try {
      raw = JSON.parse(text) as RawVersion
    } catch {
      throw new Error('版本 json 不是合法 JSON，下载源可能返回了错误内容')
    }
    if (!raw.id) throw new Error('版本 json 缺少 id 字段')
    this.vanillaRaw = raw
    this.log(
      'info',
      `版本 json 来源：${new URL(result.url).host}（${(text.length / 1024).toFixed(1)} KB）`,
    )
    if (raw.inheritsFrom) {
      this.log('warn', `该版本 JSON 继承自 ${raw.inheritsFrom}，将尝试按继承链合并`)
    }

    // 实例检查：普通版本允许按「补全 / 修复」重复安装；整合包会覆盖用户文件，需要显式确认
    const name = this.instanceName
    if (!this.retrying) {
      if (await isInstalling(root, name)) {
        throw new Error(`实例「${name}」正在安装中，请稍后再试`)
      }
      if (
        this.request.kind === 'modpack' &&
        fs.existsSync(instanceJsonPath(root, name)) &&
        !this.request.overwrite
      ) {
        throw new Error(`实例「${name}」已存在，请更换实例名称或勾选覆盖安装`)
      }
    }
    await markInstalling(root, name)
    // 先落一份「未完成」清单：任务失败/取消后，实例页仍能认出这是本工具创建的实例、
    // 显示为未完整，并按清单还原隔离目录——不再让取消安装的残骸被当成「外部创建的实例」
    await writeManifest(root, name, {
      schema: 1,
      app: 'mcdownload',
      instance: name,
      mcVersion: raw.id,
      components: this.request.components ?? {},
      isolation: this.request.isolation,
      installedAt: Date.now(),
      fileCount: 0,
      totalBytes: 0,
      complete: false,
    })

    // 基础阶段只准备原版文件
    this.basePlan = buildBasePlan({
      root,
      versionId: raw.id,
      instanceName: raw.id,
      versionUrl: this.request.versionUrl,
      versionSha1: this.request.versionSha1,
      raw,
      mode: this.mode,
      ctx,
      wantVanillaJson: true,
    })
    for (const warning of this.basePlan.warnings) this.log('warn', warning)
    this.baseQueue = this.registerFiles(this.basePlan.files)
    this.log('info', `原版清单：${this.baseQueue.length} 个待下载文件`)
    this.phase = 'base'
  }

  private ruleContext = detectRuleContext()

  private async phaseLoaders(): Promise<void> {
    const root = path.resolve(this.request.root)
    const vanilla = this.vanillaRaw
    if (!vanilla) throw new Error('内部错误：缺少原版版本 JSON')
    const components = this.request.components ?? {}
    const mcVersion = vanilla.id as string

    let merged = vanilla
    const prepared: { id: string; version: string }[] = []

    const hasModLoader = Boolean(components.fabric || components.quilt)
    const optifineAsMod = Boolean(components.optifine && hasModLoader)

    // PCL 的加载器叠加顺序：Forge/NeoForge -> OptiFine -> LiteLoader -> Fabric/Quilt
    const order: { id: 'forge' | 'neoforge' | 'optifine' | 'liteloader' | 'fabric' | 'quilt'; version?: string }[] = []
    if (components.forge) order.push({ id: 'forge', version: components.forge })
    if (components.neoforge) order.push({ id: 'neoforge', version: components.neoforge })
    if (components.optifine && !optifineAsMod) order.push({ id: 'optifine', version: components.optifine })
    if (components.liteloader) order.push({ id: 'liteloader', version: components.liteloader })
    if (components.fabric) order.push({ id: 'fabric', version: components.fabric })
    if (components.quilt) order.push({ id: 'quilt', version: components.quilt })

    if (order.length) {
      this.message = '准备加载器'
      this.emit()
    }

    for (const item of order) {
      if (!item.version) continue
      this.log('info', `正在准备 ${LOADER_LABELS[item.id]} ${item.version}`)
      const loaderCtx = this.createLoaderContext()
      const result = await prepareLoader(item.id, item.version, loaderCtx)
      merged = mergeVersionJson(merged, result.profile)
      prepared.push({ id: result.id, version: result.version })
      for (const warning of result.warnings ?? []) this.log('warn', warning)
      this.log('info', `${LOADER_LABELS[item.id]} ${item.version} 已合并进版本 JSON`)
    }

    // OptiFine 作为 Mod（Fabric/Quilt 组合）
    if (components.optifine && optifineAsMod) {
      const { type, patch } = splitOptiFineVersion(components.optifine)
      const filename = `OptiFine_${mcVersion}_${type}_${patch}.jar`
      const urls = await optiFineUrls(mcVersion, components.optifine, this.mode, this.fetchAbort.signal)
      this.modQueue.push(
        ...this.registerFiles([
          {
            kind: 'mod',
            dest: path.join(this.dataDir(), 'mods', filename),
            urls,
            size: -1,
          },
        ]),
      )
      this.log('info', 'OptiFine 将作为 Mod 安装（Fabric/Quilt 下需要 OptiFabric）')
    }

    // Fabric API / OptiFabric
    if (hasModLoader) {
      const loaders = components.fabric ? ['fabric'] : ['quilt']
      if (components.fabricApi) {
        const mod = await resolveModrinthMod('fabric-api', mcVersion, loaders, this.createLoaderContext())
        if (mod) {
          this.modQueue.push(
            ...this.registerFiles([
              {
                kind: 'mod',
                dest: path.join(this.dataDir(), 'mods', mod.filename),
                urls: [mod.url],
                size: mod.size,
                sha1: mod.sha1,
              },
            ]),
          )
          this.log('info', `将安装 Fabric API ${mod.versionName}`)
        } else {
          this.log('warn', '未能找到匹配的 Fabric API 版本，已跳过')
        }
      }
      if (components.optifabric && optifineAsMod) {
        const mod = await resolveModrinthMod('optifabric', mcVersion, loaders, this.createLoaderContext())
        if (mod) {
          this.modQueue.push(
            ...this.registerFiles([
              {
                kind: 'mod',
                dest: path.join(this.dataDir(), 'mods', mod.filename),
                urls: [mod.url],
                size: mod.size,
                sha1: mod.sha1,
              },
            ]),
          )
          this.log('info', `将安装 OptiFabric ${mod.versionName}`)
        } else {
          this.log('warn', '未能找到匹配的 OptiFabric 版本，已跳过')
        }
      }
    }

    const vanillaId = vanilla.id as string
    const needsInstanceJson =
      prepared.length > 0 || this.modQueue.length > 0 || this.instanceName !== vanillaId
    const isModpack = this.request.kind === 'modpack'
    let instanceJsonInfo: { sha1: string; size: number } | undefined
    if (needsInstanceJson || isModpack) {
      const normalized = normalizeInstanceJson(merged, this.instanceName)
      const text = JSON.stringify(normalized, null, 2)
      await writeFileAtomic(instanceJsonPath(root, this.instanceName), text)
      instanceJsonInfo = {
        sha1: crypto.createHash('sha1').update(text, 'utf8').digest('hex'),
        size: Buffer.byteLength(text, 'utf8'),
      }
      this.log('info', `已写入实例版本 JSON：versions/${this.instanceName}/${this.instanceName}.json`)
    }

    // 复制原版 jar 供实例使用
    const canonicalJar = this.basePlan?.clientJarPath
    const targetJar = instanceJarPath(root, this.instanceName)
    if (canonicalJar && fs.existsSync(canonicalJar) && targetJar.toLowerCase() !== canonicalJar.toLowerCase()) {
      await fsp.mkdir(path.dirname(targetJar), { recursive: true })
      await fsp.copyFile(canonicalJar, targetJar)
    }

    this.finalPlan = buildBasePlan({
      root,
      versionId: vanillaId,
      instanceName: this.instanceName,
      versionUrl: this.request.versionUrl,
      versionSha1: this.request.versionSha1,
      raw: { ...merged, downloads: vanilla.downloads },
      mode: this.mode,
      ctx: this.ruleContext,
      instanceJson: instanceJsonInfo,
      wantVanillaJson: vanillaId !== this.instanceName,
    })
    for (const warning of this.finalPlan.warnings) this.log('warn', warning)
    this.loaderQueue = this.registerFiles(this.finalPlan.files)
    if (this.loaderQueue.length) {
      this.log('info', `加载器/依赖清单：${this.loaderQueue.length} 个新文件`)
    }
    // 下载合并后新增的文件
    const paused = await this.runQueue(this.loaderQueue, '下载加载器依赖')
    if (paused) return
    this.phase = 'assets'
    if (prepared.length) {
      this.log('info', `已安装组件：${prepared.map((item) => `${LOADER_LABELS[item.id as keyof typeof LOADER_LABELS]} ${item.version}`).join('，')}`)
    }
  }

  private async phaseAssets(): Promise<void> {
    const root = path.resolve(this.request.root)
    const plan = this.finalPlan ?? this.basePlan
    const indexPath = plan?.assetIndexPath
    if (!indexPath) {
      this.log('warn', '该版本没有独立的资源索引，跳过资源下载')
      this.phase = 'instance'
      return
    }
    if (!this.assetQueue.length) {
      let index: AssetIndexJson
      try {
        index = JSON.parse(await fsp.readFile(indexPath, 'utf8')) as AssetIndexJson
      } catch (error) {
        this.failures.push({
          path: indexPath,
          kind: 'assetIndex',
          error: `资源索引读取失败：${errorText(error)}`,
          urls: [],
        })
        this.log('error', `资源索引不可用，跳过资源下载：${errorText(error)}`)
        this.phase = 'instance'
        return
      }
      const assetPlan = buildAssetPlan({ root, index, mode: this.mode })
      this.assetQueue = this.registerFiles(assetPlan.files)
      this.log('info', `资源索引：${this.assetQueue.length} 个对象，共 ${formatBytes(assetPlan.totalSize)}`)
    }
    const paused = await this.runQueue(this.assetQueue, '下载资源文件')
    if (paused) return
    this.phase = 'instance'
  }

  private async phaseInstance(): Promise<void> {
    const root = path.resolve(this.request.root)
    const dataDir = this.dataDir()
    this.message = '整理实例文件'
    this.emit()
    await ensureDataDirs(dataDir)

    if (this.modQueue.length) {
      const paused = await this.runQueue(this.modQueue, '下载模组文件')
      if (paused) return
    }

    if (this.request.kind === 'modpack' && this.request.modpack) {
      this.message = '解压整合包文件'
      this.emit()
      const result = await installModpack(this.request.modpack.path, this.request.modpack, {
        root,
        instanceName: this.instanceName,
        dataDir,
        tempDir: this.tempDir,
        mode: this.mode,
        signal: this.fetchAbort.signal,
        log: (level, text) => this.log(level, text),
        curseforgeApiKey: this.request.curseforgeApiKey,
      })
      for (const warning of result.warnings) this.log('warn', warning)
      if (result.extracted) this.log('info', `已解压 ${result.extracted} 个覆盖文件`)
      if (result.downloads.length) {
        await ensureModpackDirs(dataDir, result.downloads)
        const files = result.downloads.map<PlannedFile>((item) => ({
          kind: item.relativePath.replace(/\\/g, '/').startsWith('mods/') ? 'mod' : 'override',
          dest: path.join(dataDir, item.relativePath),
          urls: item.urls,
          size: item.size,
          sha1: item.sha1,
        }))
        const queue = this.registerFiles(files)
        this.log('info', `整合包待下载文件：${queue.length} 个`)
        const paused = await this.runQueue(queue, '下载整合包文件')
        if (paused) return
      }
    }

    await this.writeInstallManifest()
    await unmarkInstalling(root, this.instanceName)
    this.phase = 'done'
  }

  private async phaseExtract(): Promise<void> {
    const root = path.resolve(this.request.root)
    const name = this.instanceName
    if (!this.retrying && fs.existsSync(path.join(root, 'versions', name)) && !this.request.overwrite) {
      throw new Error(`实例「${name}」已存在，请更换实例名称或勾选覆盖安装`)
    }
    await markInstalling(root, name)
    this.message = '解压整合包'
    this.emit()
    const info = this.request.modpack
    if (!info) throw new Error('内部错误：缺少整合包信息')
    const result = await installModpack(info.path, info, {
      root,
      instanceName: name,
      dataDir: path.join(root, 'versions', name),
      tempDir: this.tempDir,
      mode: this.mode,
      signal: this.fetchAbort.signal,
      log: (level, text) => this.log(level, text),
      curseforgeApiKey: this.request.curseforgeApiKey,
    })
    for (const warning of result.warnings) this.log('warn', warning)
    this.log('info', `已解压 ${result.extracted} 个文件到 ${root}`)
    if (!result.compressOnly) {
      this.failures.push({ path: info.path, kind: 'override', error: '整合包内容不完整', urls: [] })
    }
    await unmarkInstalling(root, name)
    this.phase = 'done'
  }

  // ------------------------------------------------------------------ 下载队列

  private async runQueue(queue: PlannedFile[], label: string): Promise<boolean> {
    if (!queue.length) return false
    this.message = label
    this.emit()
    const result = await this.engine.run(queue)
    this.absorbFailure(result)
    if (result.aborted || this.state !== 'running') {
      this.pendingQueue = result.remaining.length ? result.remaining : null
      return true
    }
    this.pendingQueue = null
    if (result.remaining.length) {
      // 引擎只在暂停/取消时才会把文件留在 remaining 里；没有中止却还剩文件，
      // 说明有文件没下完。逐个记为失败，绝不能静默丢弃再给该阶段打「完成」
      for (const file of result.remaining) {
        this.failures.push({
          path: file.dest,
          kind: file.kind,
          error: '文件未下载完成（队列提前结束）',
          urls: file.urls,
        })
      }
      this.log('warn', `${result.remaining.length} 个文件未下载，已记录为失败`)
    }
    this.log(
      'info',
      `${label}完成：跳过已存在 ${result.skipped.length} 个，失败 ${result.failed.length} 个`,
    )
    return false
  }

  private async fetchOneFile(urls: string[], dest: string, minSize = 0): Promise<void> {
    const file: PlannedFile = { kind: 'loader', dest, urls, size: -1 }
    const queue = this.registerFiles([file])
    if (!queue.length) {
      // 暂停-继续 / 加载器阶段重跑后的再次进入：路径虽已在 plannedDests 登记过，
      // 不代表文件真的落地。必须 stat 验证，缺失就重新入队下载——
      // 此前这里直接 return 成功，导致 forge / optifine 安装器 jar 缺失后 ENOENT
      const stat = await fsp.stat(dest).catch(() => null)
      if (stat && stat.isFile() && (!minSize || stat.size >= minSize)) return
      queue.push(file)
    }
    this.message = `下载 ${path.basename(dest)}`
    this.emit()
    const result = await this.engine.run(queue)
    if (result.aborted) throw new Error('已取消')
    if (result.failed.length) throw new Error(result.failed[0].error)
    const stat = await fsp.stat(dest).catch(() => null)
    if (!stat) throw new Error(`下载失败：${path.basename(dest)}`)
    if (minSize && stat.size < minSize) {
      await fsp.rm(dest, { force: true })
      throw new Error(`下载到的文件不完整：${path.basename(dest)}（${stat.size} 字节）`)
    }
  }

  private createLoaderContext(): LoaderContext {
    return {
      root: path.resolve(this.request.root),
      instanceName: this.instanceName,
      mcVersion: this.vanillaRaw?.id as string,
      mode: this.mode,
      signal: this.fetchAbort.signal,
      tempDir: this.tempDir,
      log: (level, text) => this.log(level, text),
      fetchFile: (urls, dest, options) => this.fetchOneFile(urls, dest, options?.minSize ?? 0),
      runInstaller: (javaArgs, options) => this.runJavaInstaller(javaArgs, options),
    }
  }

  private async runJavaInstaller(
    javaArgs: string[],
    options?: { timeoutMs?: number; minJava?: number; env?: Record<string, string> },
  ): Promise<void> {
    const java = await pickJava(options?.minJava)
    if (!java) {
      throw new Error(
        '该安装器需要 Java 才能运行，但本机没有检测到 Java。请安装 Java 8+ 后重试，或设置环境变量 JAVA_HOME 指向 Java 目录。',
      )
    }
    this.log('info', `使用 Java ${java.version}（${java.source}）运行安装器`)
    const process = await runJava(java.path, {
      args: javaArgs,
      cwd: path.resolve(this.request.root),
      env: options?.env,
      timeoutMs: options?.timeoutMs,
      onLine: (line) => this.log('debug', `[安装器] ${line}`),
    })
    if (process.code !== 0) {
      const tail = process.output.trim().split(/\r?\n/).slice(-3).join(' / ')
      throw new Error(`安装器运行失败（退出码 ${process.code}）：${tail}`)
    }
  }

  private finish(): void {
    this.stopTicker()
    this.finishedAt = Date.now()
    this.state = this.failures.length ? 'failed' : 'finished'
    this.message = this.failures.length ? `${this.failures.length} 个文件失败` : '安装完成'
    if (this.state === 'finished') {
      this.speed = 0
      this.doneBytes = this.totalBytes
      this.doneFiles = this.totalFiles
      for (const stage of this.stageStats.values()) {
        stage.doneBytes = stage.totalBytes
        stage.doneFiles = stage.totalFiles
      }
      this.log(
        'info',
        `全部完成：${this.doneFiles}/${this.totalFiles} 个文件，共 ${formatBytes(this.totalBytes)}，用时 ${formatDuration(
          (this.finishedAt - this.startedAt) / 1000,
        )}`,
      )
    } else {
      this.log('error', `${this.failures.length} 个文件下载失败，可在界面中重试`)
    }
    void fsp.rm(this.tempDir, { recursive: true, force: true })
    this.emit()
  }

  // ------------------------------------------------------------------ 清单与统计

  private dataDir(): string {
    const root = path.resolve(this.request.root)
    return this.request.isolation === false
      ? root
      : this.request.kind === 'modpack'
        ? instanceDir(root, this.instanceName)
        : dataDirOf(root, this.instanceName, this.request.isolation ?? true)
  }

  private registerFiles(files: PlannedFile[]): PlannedFile[] {
    const added: PlannedFile[] = []
    for (const file of files) {
      const key = file.dest.toLowerCase()
      if (this.plannedDests.has(key)) continue
      this.plannedDests.add(key)
      added.push(file)
      const stage = this.ensureStage(file.kind)
      stage.totalFiles++
      this.totalFiles++
      if (file.size > 0) {
        stage.totalBytes += file.size
        this.totalBytes += file.size
      }
    }
    return added
  }

  private handleFileStart(file: PlannedFile): void {
    const previous = this.fileBytes.get(file.dest) ?? 0
    if (previous > 0) {
      this.doneBytes -= previous
      this.stageBytes(file.kind, -previous)
    }
    this.fileBytes.set(file.dest, 0)
    this.message = `下载 ${this.shortPath(file.dest)}`
  }

  private handleBytes(file: PlannedFile, delta: number): void {
    this.fileBytes.set(file.dest, (this.fileBytes.get(file.dest) ?? 0) + delta)
    this.doneBytes += delta
    this.stageBytes(file.kind, delta)
  }

  private handleFileDone(file: PlannedFile): void {
    if (this.completed.has(file.dest)) return
    this.completed.add(file.dest)
    this.doneFiles++
    const stage = this.ensureStage(file.kind)
    stage.doneFiles++
    const counted = this.fileBytes.get(file.dest) ?? 0
    if (file.size > 0 && counted < file.size) {
      const diff = file.size - counted
      this.doneBytes += diff
      this.stageBytes(file.kind, diff)
      this.fileBytes.set(file.dest, file.size)
    }
  }

  private handleFileSkip(file: PlannedFile): void {
    if (this.completed.has(file.dest)) return
    this.completed.add(file.dest)
    this.doneFiles++
    const stage = this.ensureStage(file.kind)
    stage.doneFiles++
    if (file.size > 0) {
      this.doneBytes += file.size
      this.stageBytes(file.kind, file.size)
      this.fileBytes.set(file.dest, file.size)
    }
  }

  private stageBytes(kind: FileKind, delta: number): void {
    const stage = this.ensureStage(kind)
    stage.doneBytes = Math.max(0, stage.doneBytes + delta)
  }

  private ensureStage(id: StageId): StageStats {
    let stage = this.stageStats.get(id)
    if (!stage) {
      stage = {
        id,
        label: STAGE_LABELS[id],
        totalBytes: 0,
        doneBytes: 0,
        totalFiles: 0,
        doneFiles: 0,
      }
      this.stageStats.set(id, stage)
    }
    return stage
  }

  private absorbFailure(result: RunResult): void {
    if (result.failed.length) this.failures.push(...result.failed)
  }

  private resetProgress(): void {
    this.completed.clear()
    this.fileBytes.clear()
    this.stageStats.clear()
    this.plannedDests.clear()
    this.failures = []
    this.doneBytes = 0
    this.totalBytes = 0
    this.doneFiles = 0
    this.totalFiles = 0
    this.speed = 0
    this.lastSpeedBytes = 0
    this.lastSpeedAt = Date.now()
    this.message = '准备中'
  }

  private allFiles(): PlannedFile[] {
    return [
      ...this.baseQueue,
      ...this.loaderQueue,
      ...this.assetQueue,
      ...this.modQueue,
      ...(this.pendingQueue ? [this.pendingQueue].flat() : []),
    ]
  }

  private eta(): number {
    if (this.state === 'finished') return 0
    if (this.speed <= 0) return -1
    const remaining = this.totalBytes - this.doneBytes
    if (remaining <= 0) return -1
    return remaining / this.speed
  }

  // ------------------------------------------------------------------ 其它

  private async writeInstallManifest(): Promise<void> {
    const root = path.resolve(this.request.root)
    const vanilla = this.vanillaRaw
    await writeManifest(root, this.instanceName, {
      schema: 1,
      app: 'mcdownload',
      instance: this.instanceName,
      mcVersion: vanilla?.id ?? this.request.versionId,
      components: this.request.components ?? {},
      isolation: this.request.isolation,
      installedAt: Date.now(),
      fileCount: this.totalFiles,
      totalBytes: this.totalBytes,
      // 清单必须如实反映本轮失败状态，不能无条件把半成品标成 complete
      complete: this.failures.length === 0,
    })
  }

  private startTicker(): void {
    this.stopTicker()
    this.lastSpeedAt = Date.now()
    this.lastSpeedBytes = this.doneBytes
    this.tickTimer = setInterval(() => this.tick(), 250)
  }

  private stopTicker(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
  }

  private tick(): void {
    const now = Date.now()
    const elapsed = (now - this.lastSpeedAt) / 1000
    if (elapsed >= 0.2) {
      const instant = (this.doneBytes - this.lastSpeedBytes) / elapsed
      this.speed = this.speed === 0 ? instant : this.speed * 0.55 + instant * 0.45
      this.lastSpeedAt = now
      this.lastSpeedBytes = this.doneBytes
    }
    this.emit()
  }

  private emit(): void {
    this.hooks.emitSnapshot(this.getSnapshot())
  }

  private log(level: 'info' | 'warn' | 'error' | 'debug', text: string): void {
    this.hooks.emitLog({ time: Date.now(), level, text })
  }

  private shortPath(target: string): string {
    const root = path.resolve(this.request.root)
    const relative = path.relative(root, target)
    return relative.startsWith('..') ? target : relative
  }
}

interface StageStats extends StageProgress {
  id: StageId
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h} 小时 ${m} 分`
  if (m > 0) return `${m} 分 ${s} 秒`
  return `${s} 秒`
}

/** 供测试脚本使用的工具函数 */
export async function verifyFileSha1(filePath: string, sha1: string): Promise<boolean> {
  return (await sha1File(filePath)) === sha1.toLowerCase()
}




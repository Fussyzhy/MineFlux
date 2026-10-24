/**
 * 版本文件下载清单的构造。
 * 对应 PCL 的 `DlClientFix` / `DlLibTask` / `DlAssetsFix`。
 */
import path from 'node:path'
import type { FileKind, SourceMode } from '../shared/types'
import { assetObjectUrl, assetUrls, libraryUrls, metaUrls } from './mirror'
import { isRuleAllowed, is64Bit, type RuleContext } from './rules'
import type { RawVersion } from './version-json'
import { mavenRelativePath } from './maven'

export type { RawArtifact, RawAssetIndex, RawLibrary, RawVersion } from './version-json'

export interface PlannedFile {
  kind: FileKind
  /** 绝对路径 */
  dest: string
  urls: string[]
  /** -1 表示大小未知 */
  size: number
  sha1?: string
  /** 镜像文件允许的最小体积（防止把错误页面当成文件保存），仅用于安装器 */
  minSize?: number
}

export interface BasePlan {
  versionId: string
  instanceName: string
  /** 原版版本 json（versions/<mc>/<mc>.json），供安装器与修复使用 */
  versionJsonPath: string | null
  instanceJsonPath: string
  /** 原版客户端 jar（versions/<mc>/<mc>.jar） */
  clientJarPath: string | null
  /** 实例可见的 jar（versions/<instance>/<instance>.jar） */
  instanceJarPath: string | null
  files: PlannedFile[]
  warnings: string[]
  /** 资源索引文件（下载完成后再解析出 objects） */
  assetIndexPath: string | null
  javaMajorVersion?: number
}

export interface AssetObject {
  hash: string
  size: number
}

export function normalizeRoot(root: string): string {
  return path.resolve(root)
}

function toPlanned(
  kind: FileKind,
  root: string,
  relative: string,
  urls: string[],
  size: number | undefined,
  sha1: string | undefined,
): PlannedFile {
  return {
    kind,
    dest: path.join(root, relative),
    urls,
    size: typeof size === 'number' ? size : -1,
    sha1: sha1?.toLowerCase(),
  }
}

/** 没有 downloads 节点时的兜底下载地址：Mojang 官方库 + Maven Central */
function fallbackLibraryUrls(relative: string, mode: SourceMode): string[] {
  const official = `https://libraries.minecraft.net/${relative}`
  const urls = libraryUrls(official, mode)
  const central = `https://repo1.maven.org/maven2/${relative}`
  if (!urls.includes(central)) urls.push(central)
  return urls
}

/** 第三方 maven（Forge / Fabric / NeoForge 等）的镜像映射 */
function thirdPartyUrls(url: string, mode: SourceMode): string[] {
  const rewritten = url
    .replace('https://maven.minecraftforge.net', 'https://bmclapi2.bangbang93.com/maven')
    .replace('https://maven.neoforged.net/releases', 'https://bmclapi2.bangbang93.com/maven')
    .replace('https://maven.fabricmc.net', 'https://bmclapi2.bangbang93.com/maven')
    .replace('https://maven.quiltmc.org/repository/release', 'https://bmclapi2.bangbang93.com/maven')
  if (rewritten === url) return [url]
  if (mode === 'mirror') return [rewritten]
  if (mode === 'official') return [url, rewritten]
  return [rewritten, url]
}

/**
 * 生成「除 assets/objects 之外」的下载清单。
 * @param instanceJson 已经写好的实例 JSON（提供 sha1/size 时会被纳入清单并跳过下载）
 * @param workRoot 安装工作区（PCL 的 TempMcFolder）。给出时，versions/ 下的原版 json / jar
 *   会写进工作区而不是真实游戏目录，避免在 versions/ 里留下「原版基座」目录；
 *   libraries/ 与 assets/ 始终使用真实的 root，保持多实例共享。
 */
export function buildBasePlan(options: {
  root: string
  versionId: string
  instanceName?: string
  versionUrl?: string
  versionSha1?: string
  raw: RawVersion
  mode: SourceMode
  ctx: RuleContext
  /** 已经写入磁盘的实例 JSON；有值时不再单独下载原版 JSON */
  instanceJson?: { sha1: string; size: number }
  /** 是否把原版 JSON 也放进下载清单（实例名与原版不同名时需要，安装器会读它） */
  wantVanillaJson?: boolean
  workRoot?: string
}): BasePlan {
  const { root, raw, mode, ctx } = options
  // versions/ 与 launcher_profiles.json 之类放在工作区，libraries/assets 用真实 root
  const versionsRoot = options.workRoot ?? root
  const versionId = options.versionId
  const instanceName = options.instanceName ?? versionId
  const files: PlannedFile[] = []
  const warnings: string[] = []

  const vanillaJsonRel = path.join('versions', versionId, `${versionId}.json`)
  const instanceJsonRel = path.join('versions', instanceName, `${instanceName}.json`)
  const wantVanillaJson = options.wantVanillaJson ?? instanceName !== versionId
  if (wantVanillaJson && options.versionUrl) {
    files.push(
      toPlanned(
        'versionJson',
        versionsRoot,
        vanillaJsonRel,
        metaUrls(options.versionUrl, mode),
        undefined,
        options.versionSha1,
      ),
    )
  }
  if (options.instanceJson) {
    files.push(
      toPlanned(
        'versionJson',
        versionsRoot,
        instanceJsonRel,
        [],
        options.instanceJson.size,
        options.instanceJson.sha1,
      ),
    )
  }

  const clientArtifact = raw.downloads?.client
  let clientJarPath: string | null = null
  let instanceJarPath: string | null = null
  if (clientArtifact?.url) {
    clientJarPath = path.join(versionsRoot, 'versions', versionId, `${versionId}.jar`)
    files.push(
      toPlanned(
        'client',
        versionsRoot,
        path.join('versions', versionId, `${versionId}.jar`),
        metaUrls(clientArtifact.url, mode),
        clientArtifact.size,
        clientArtifact.sha1,
      ),
    )
    instanceJarPath = path.join(versionsRoot, 'versions', instanceName, `${instanceName}.jar`)
    // 实例 jar 由任务在下载完成后复制，这里只登记校验信息以便统计与修复
    files.push(
      toPlanned(
        'client',
        versionsRoot,
        path.join('versions', instanceName, `${instanceName}.jar`),
        instanceName === versionId ? metaUrls(clientArtifact.url, mode) : [],
        clientArtifact.size,
        clientArtifact.sha1,
      ),
    )
  } else if (raw.jar) {
    // 旧版继承 JSON：客户端 jar 指向父版本
    clientJarPath = path.join(versionsRoot, 'versions', raw.jar, `${raw.jar}.jar`)
    instanceJarPath = path.join(versionsRoot, 'versions', instanceName, `${instanceName}.jar`)
    warnings.push(`该版本复用 ${raw.jar} 的客户端 jar`)
  } else {
    warnings.push('该版本 json 中没有客户端 jar 的下载信息（可能是继承版本或仅有资源）')
  }

  for (const lib of raw.libraries ?? []) {
    if (!isRuleAllowed(lib.rules, ctx)) continue
    const artifact = lib.downloads?.artifact
    if (artifact) {
      const rel = artifact.path ?? (lib.name ? mavenRelativePath(lib.name) : null)
      if (!rel) continue
      const urls =
        artifact.url === ''
          ? []
          : artifact.url
            ? thirdPartyUrls(artifact.url, mode)
            : fallbackLibraryUrls(rel, mode)
      files.push(
        toPlanned('library', root, path.join('libraries', rel), urls, artifact.size, artifact.sha1),
      )
    } else if (lib.name && lib.url && !lib.natives) {
      const rel = mavenRelativePath(lib.name)
      if (rel) {
        const base = lib.url.endsWith('/') ? lib.url : `${lib.url}/`
        files.push(
          toPlanned(
            'library',
            root,
            path.join('libraries', rel),
            thirdPartyUrls(base + rel, mode),
            -1,
            undefined,
          ),
        )
      }
    } else if (lib.name && !lib.natives) {
      const rel = mavenRelativePath(lib.name)
      if (rel) {
        files.push(
          toPlanned('library', root, path.join('libraries', rel), fallbackLibraryUrls(rel, mode), -1, undefined),
        )
      } else {
        warnings.push(`无法解析库坐标，已跳过：${lib.name}`)
      }
    }

    // natives（旧版依赖：把平台相关的 jar 解压出 dll/so，这里只负责下载）
    const nativesKey = lib.natives?.[ctx.osName]
    if (!nativesKey) continue
    const resolvedKey = nativesKey.replace('${arch}', is64Bit() ? '64' : '32')
    const classifier = lib.downloads?.classifiers?.[resolvedKey] ?? lib.downloads?.classifiers?.[nativesKey]
    if (!classifier?.url) {
      warnings.push(`natives 缺少 classifier 下载信息：${lib.name ?? '(未知)'} / ${nativesKey}`)
      continue
    }
    const rel = classifier.path ?? (lib.name ? mavenRelativePath(`${lib.name}:${resolvedKey}`) : null)
    if (!rel) continue
    files.push(
      toPlanned(
        'library',
        root,
        path.join('libraries', rel),
        libraryUrls(classifier.url, mode),
        classifier.size,
        classifier.sha1,
      ),
    )
  }

  let assetIndexPath: string | null = null
  const assetIndex = raw.assetIndex
  if (assetIndex?.url) {
    const indexId = assetIndex.id ?? versionId
    assetIndexPath = path.join(root, 'assets', 'indexes', `${indexId}.json`)
    files.push(
      toPlanned(
        'assetIndex',
        root,
        path.join('assets', 'indexes', `${indexId}.json`),
        metaUrls(assetIndex.url, mode),
        assetIndex.size,
        assetIndex.sha1,
      ),
    )
  } else if (raw.assets && !raw.assetIndex) {
    warnings.push(
      `该版本使用旧版资源格式（assets="${raw.assets}"），资源直接来自客户端 jar，无需单独下载`,
    )
  }

  const loggingFile = raw.logging?.client?.file
  if (loggingFile?.url && loggingFile.id) {
    files.push(
      toPlanned(
        'logging',
        root,
        path.join('assets', 'log_configs', loggingFile.id),
        metaUrls(loggingFile.url, mode),
        loggingFile.size,
        loggingFile.sha1,
      ),
    )
  }

  return {
    versionId,
    instanceName,
    versionJsonPath: wantVanillaJson ? path.join(root, vanillaJsonRel) : null,
    instanceJsonPath: path.join(root, instanceJsonRel),
    clientJarPath,
    instanceJarPath,
    files: dedupeByDest(files),
    warnings,
    assetIndexPath,
    javaMajorVersion: raw.javaVersion?.majorVersion,
  }
}


export interface AssetIndexJson {
  objects?: Record<string, { hash?: string; size?: number }>
  map_to_resources?: boolean
  virtual?: boolean
}

/** 解析 resources index，生成 assets/objects 下载清单 */
export function buildAssetPlan(options: {
  root: string
  index: AssetIndexJson
  mode: SourceMode
}): { files: PlannedFile[]; totalSize: number } {
  const { root, index, mode } = options
  const files: PlannedFile[] = []
  const seen = new Set<string>()
  let totalSize = 0
  for (const entry of Object.values(index.objects ?? {})) {
    const hash = entry.hash
    const size = entry.size
    if (!hash || typeof size !== 'number') continue
    const rel = path.join('assets', 'objects', hash.slice(0, 2), hash)
    if (seen.has(rel)) continue
    seen.add(rel)
    totalSize += size
    files.push(toPlanned('asset', root, rel, assetUrls(assetObjectUrl(hash), mode), size, hash))
  }
  return { files, totalSize }
}

export function dedupeByDest(files: PlannedFile[]): PlannedFile[] {
  const map = new Map<string, PlannedFile>()
  for (const file of files) {
    const key = file.dest.toLowerCase()
    if (!map.has(key)) map.set(key, file)
  }
  return [...map.values()]
}



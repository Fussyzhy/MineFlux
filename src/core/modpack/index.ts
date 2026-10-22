/**
 * 整合包安装。
 * 对应 PCL 的 `ModModpack.vb`：
 *   InstallPackCurseForge / InstallPackModrinth / InstallPackHMCL / InstallPackMMC /
 *   InstallPackMCBBS / InstallPackLauncherPack / InstallPackCompress
 *
 * 这里负责「识别类型 + 解析依赖 + 解压覆盖文件 + 给出待下载文件清单」，
 * 真正的下载交给 InstallTask 的下载引擎。
 */
import path from 'node:path'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import type { InstallComponents, ModpackInfo, ModpackType, SourceMode } from '../../shared/types'
import {
  CURSEFORGE_API,
  CURSEFORGE_CDN,
  CURSEFORGE_MIRROR_API,
  CURSEFORGE_MIRROR_CDN,
} from '../loaders/sources'
import { ensureDir, safeJoin, writeJsonAtomic } from '../fsutil'
import { readZipEntries, readZipEntry, extractZip, type ZipEntry, isZipFile } from '../zip'

/** 待下载的整合包文件（路径相对于实例数据目录） */
export interface ModpackDownload {
  relativePath: string
  urls: string[]
  sha1?: string
  size: number
  label: string
}

export interface ModpackInstallContext {
  root: string
  instanceName: string
  dataDir: string
  tempDir: string
  mode: SourceMode
  signal: AbortSignal
  log: (level: 'info' | 'warn' | 'error', text: string) => void
  curseforgeApiKey?: string
}

export interface ModpackInstallResult {
  downloads: ModpackDownload[]
  warnings: string[]
  /** 仅解压类整合包没有版本信息 */
  compressOnly?: boolean
  extracted: number
}

const KNOWN_FILES = [
  'mcbbs.packmeta',
  'modrinth.index.json',
  'mmc-pack.json',
  'modpack.json',
  'manifest.json',
  'modpack.zip',
  'modpack.mrpack',
]

interface Archive {
  buffer: Buffer
  entries: ZipEntry[]
  /** zip 内公共前缀（整合包可能被包了一层文件夹） */
  prefix: string
}

function archiveFrom(buffer: Buffer): Archive {
  const entries = readZipEntries(buffer)
  const prefix = detectPrefix(entries)
  return { buffer, entries, prefix }
}

/** 探测 zip 内的公共前缀（例如 "MyPack/"） */
function detectPrefix(entries: ZipEntry[]): string {
  const names = entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name)
  if (!names.length) return ''
  const known = KNOWN_FILES.map((name) => names.find((item) => item.toLowerCase().endsWith(name)))
  const hit = known.find(Boolean)
  if (hit) {
    const index = hit.lastIndexOf('/')
    return index < 0 ? '' : hit.slice(0, index + 1)
  }
  // 没有已知文件时，取最短路径作为基准，判断是否所有文件都在同一个顶级目录下
  const firstSegments = new Set(names.map((name) => (name.includes('/') ? name.split('/')[0] : '')))
  if (firstSegments.size === 1) {
    const [segment] = [...firstSegments]
    if (segment && names.every((name) => name.startsWith(`${segment}/`))) return `${segment}/`
  }
  return ''
}

function entryName(entry: ZipEntry): string {
  return entry.name.replace(/\\/g, '/')
}

function findEntry(
  archive: Archive,
  name: string,
): ZipEntry | undefined {
  const target = `${archive.prefix}${name}`.toLowerCase()
  return archive.entries.find((entry) => !entry.isDirectory && entryName(entry).toLowerCase() === target)
}

function readJson<T>(archive: Archive, name: string): T | null {
  const entry = findEntry(archive, name)
  if (!entry) return null
  try {
    return JSON.parse(readZipEntry(archive.buffer, entry).toString('utf8').replace(/^\uFEFF/, '')) as T
  } catch {
    return null
  }
}

/** 找到最内层真正的整合包归档（处理 launcherpack 的嵌套压缩包） */
async function resolveArchive(file: string, log: ModpackInstallContext['log'], tempDir?: string): Promise<Archive> {
  let buffer: Buffer = await fsp.readFile(file)
  let archive = archiveFrom(buffer)
  for (let depth = 0; depth < 3; depth++) {
    const nested = archive.entries.find((entry) => {
      if (entry.isDirectory) return false
      const name = entryName(entry).toLowerCase()
      return name.endsWith('.mrpack') || name.endsWith('.zip') || name.endsWith('.rar')
    })
    const hasManifest = KNOWN_FILES.slice(0, 5).some((name) => findEntry(archive, name))
    if (hasManifest || !nested) return archive
    const nestedName = entryName(nested).toLowerCase()
    if (nestedName.endsWith('.rar')) {
      throw new Error('暂不支持 RAR 格式的整合包，请使用 ZIP / MRPACK')
    }
    log('info', `检测到嵌套整合包：${entryName(nested)}`)
    buffer = readZipEntry(archive.buffer, nested)
    archive = archiveFrom(buffer)
    if (tempDir) {
      const nestedPath = path.join(tempDir, `nested-${depth}.zip`)
      await ensureDir(tempDir)
      await fsp.writeFile(nestedPath, buffer)
    }
  }
  return archive
}

/** 识别整合包类型 */
export function detectModpackType(archive: Archive): { type: ModpackType; archive: Archive } {
  const has = (name: string): boolean => Boolean(findEntry(archive, name))
  if (has('mcbbs.packmeta')) return { type: 'mcbbs', archive }
  if (has('modrinth.index.json')) return { type: 'modrinth', archive }
  if (has('mmc-pack.json')) return { type: 'mmc', archive }
  if (has('modpack.json')) return { type: 'hmcl', archive }
  if (has('manifest.json')) {
    const manifest = readJson<{ addons?: unknown }>(archive, 'manifest.json')
    return { type: manifest && manifest.addons ? 'mcbbs' : 'curseforge', archive }
  }
  if (has('modpack.zip') || has('modpack.mrpack')) return { type: 'launcherpack', archive }
  // 普通 .minecraft 备份：寻找 versions/<ver>/<ver>.json
  const versionEntry = archive.entries.find((entry) => {
    if (entry.isDirectory) return false
    const match = /(?:^|\/)(versions\/([^/]+)\/\2\.json)$/i.exec(entryName(entry))
    return Boolean(match)
  })
  if (versionEntry) return { type: 'compress', archive }
  throw new Error('无法识别的整合包格式（缺少 manifest.json / modrinth.index.json / mmc-pack.json 等）')
}

function parseForgeId(id: string): InstallComponents {
  const components: InstallComponents = {}
  const value = id.toLowerCase()
  if (value.startsWith('forge-')) components.forge = id.slice('forge-'.length)
  else if (value.startsWith('neoforge-')) components.neoforge = id.slice('neoforge-'.length)
  else if (value.startsWith('fabric-')) components.fabric = id.slice('fabric-'.length)
  else if (value.startsWith('quilt-')) components.quilt = id.slice('quilt-'.length)
  else if (value.startsWith('liteloader-')) components.liteloader = id.slice('liteloader-'.length)
  return components
}

interface CurseForgeManifest {
  name?: string
  version?: string
  minecraft?: { version?: string; modLoaders?: { id?: string; primary?: boolean }[] }
  files?: { projectID?: number; fileID?: number; required?: boolean }[]
  overrides?: string
}

interface ModrinthIndex {
  name?: string
  versionId?: string
  dependencies?: Record<string, string>
  files?: {
    path?: string
    size?: number
    hashes?: { sha1?: string }
    downloads?: string[]
    env?: { client?: string; server?: string }
  }[]
}

/** 解析整合包元信息（不下载任何文件） */
export async function inspectModpack(file: string, log: ModpackInstallContext['log'] = () => {}): Promise<ModpackInfo> {
  if (!fs.existsSync(file)) throw new Error(`文件不存在：${file}`)
  if (!isZipFile(file)) {
    if (file.toLowerCase().endsWith('.rar')) throw new Error('暂不支持 RAR 格式的整合包')
    throw new Error('选择的文件不是 ZIP 格式的整合包')
  }
  const resolved = await resolveArchive(file, log)
  const { type, archive } = detectModpackType(resolved)
  const fileEntries = archive.entries.filter((entry) => !entry.isDirectory)
  const totalBytes = fileEntries.reduce((sum, entry) => sum + entry.size, 0)
  const info: ModpackInfo = {
    path: file,
    type,
    name: '',
    components: {},
    mcVersion: undefined,
    fileCount: fileEntries.length,
    totalBytes,
    warnings: [],
  }

  switch (type) {
    case 'modrinth': {
      const index = readJson<ModrinthIndex>(archive, 'modrinth.index.json')
      if (!index) throw new Error('Modrinth 整合包缺少有效的 modrinth.index.json')
      info.name = index.name ?? path.basename(file, path.extname(file))
      info.packVersion = index.versionId
      const deps = index.dependencies ?? {}
      info.mcVersion = deps.minecraft
      for (const [key, value] of Object.entries(deps)) {
        switch (key.toLowerCase()) {
          case 'forge':
            info.components.forge = value
            break
          case 'neoforge':
          case 'neo-forge':
            info.components.neoforge = value
            break
          case 'fabric-loader':
            info.components.fabric = value
            break
          case 'quilt-loader':
            info.components.quilt = value
            break
          case 'minecraft':
            break
          default:
            info.warnings.push(`未知的依赖：${key}`)
        }
      }
      info.fileCount = index.files?.length ?? 0
      info.totalBytes = (index.files ?? []).reduce((sum, item) => sum + (item.size ?? 0), 0)
      break
    }
    case 'curseforge': {
      const manifest = readJson<CurseForgeManifest>(archive, 'manifest.json')
      if (!manifest?.minecraft?.version) throw new Error('CurseForge 整合包未提供 Minecraft 版本信息')
      info.name = manifest.name ?? path.basename(file, path.extname(file))
      info.packVersion = manifest.version
      info.mcVersion = manifest.minecraft.version
      for (const loader of manifest.minecraft.modLoaders ?? []) {
        if (!loader.id) continue
        Object.assign(info.components, parseForgeId(loader.id))
      }
      info.fileCount = manifest.files?.length ?? 0
      info.totalBytes = 0
      info.requiresJava = Boolean(info.components.forge || info.components.neoforge)
      break
    }
    case 'hmcl': {
      const manifest = readJson<{ name?: string; gameVersion?: string; version?: string }>(archive, 'modpack.json')
      if (!manifest?.gameVersion) throw new Error('HMCL 整合包未提供游戏版本信息')
      info.name = manifest.name ?? path.basename(file, path.extname(file))
      info.packVersion = manifest.version
      info.mcVersion = manifest.gameVersion
      break
    }
    case 'mmc': {
      const pack = readJson<{ components?: { uid?: string; version?: string }[] }>(archive, 'mmc-pack.json')
      if (!pack?.components?.length) throw new Error('MMC 整合包未提供游戏版本信息')
      info.name = readInstanceName(archive) ?? path.basename(file, path.extname(file))
      for (const component of pack.components) {
        const uid = component.uid ?? ''
        const version = component.version ?? ''
        if (uid === 'net.minecraft') info.mcVersion = version
        else if (uid === 'net.minecraftforge') info.components.forge = version
        else if (uid === 'net.neoforged') info.components.neoforge = version
        else if (uid === 'net.fabricmc.fabric-loader') info.components.fabric = version
        else if (uid === 'org.quiltmc.quilt-loader') info.components.quilt = version
        else if (version) info.warnings.push(`MMC 组件 ${uid} 未支持，已忽略`)
      }
      if (!info.mcVersion) throw new Error('MMC 整合包没有 net.minecraft 组件')
      break
    }
    case 'mcbbs': {
      interface McbbsMeta {
        name?: string
        version?: string
        addons?: unknown
        launchInfo?: Record<string, unknown>
      }
      const meta: McbbsMeta | null =
        readJson<McbbsMeta>(archive, 'mcbbs.packmeta') ??
        readJson<McbbsMeta>(archive, 'manifest.json')
      if (!meta) throw new Error('MCBBS 整合包缺少有效的 packmeta')
      info.name = meta.name ?? path.basename(file, path.extname(file))
      info.packVersion = meta.version
      const addons = normalizeAddons(meta.addons)
      info.mcVersion = addons.game ?? (meta.launchInfo?.game as string | undefined)
      if (!info.mcVersion) throw new Error('该 MCBBS 整合包未提供游戏版本信息')
      if (addons.forge) info.components.forge = addons.forge
      if (addons.neoforge) info.components.neoforge = addons.neoforge
      if (addons.fabric) info.components.fabric = addons.fabric
      if (addons.quilt) info.components.quilt = addons.quilt
      if (addons.liteloader) info.components.liteloader = addons.liteloader
      if (addons.optifine) info.components.optifine = addons.optifine
      break
    }
    case 'launcherpack':
      throw new Error('嵌套整合包解析失败，请检查压缩包内的 modpack.zip / modpack.mrpack')
    case 'compress': {
      // 解压类整合包：整个 .minecraft 备份
      info.name = path.basename(file, path.extname(file))
      const versionEntry = archive.entries
        .map(entryName)
        .find((name) => /(?:^|\/)versions\/[^/]+\/[^/]+\.json$/i.test(name))
      const match = versionEntry ? /versions\/([^/]+)\/\1\.json$/i.exec(versionEntry) : null
      info.mcVersion = match?.[1]
      info.warnings.push('这是 .minecraft 备份包，将直接解压覆盖到游戏目录')
      break
    }
    default:
      throw new Error(`暂不支持该整合包类型：${type}`)
  }
  return info
}

function readInstanceName(archive: Archive): string | null {
  const entry = findEntry(archive, 'instance.cfg')
  if (!entry) return null
  const text = readZipEntry(archive.buffer, entry).toString('utf8')
  const match = /^\s*name\s*=\s*(.+)$/m.exec(text)
  return match ? match[1].trim() : null
}

function normalizeAddons(addons: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  if (!addons) return result
  if (Array.isArray(addons)) {
    for (const item of addons) {
      if (typeof item === 'string' && item.includes(':')) {
        const [key, value] = item.split(':', 2)
        result[key.trim().toLowerCase()] = value.trim()
      } else if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        const key = String(record.type ?? record.id ?? '').toLowerCase()
        const value = record.version ?? record.value
        if (key && value) result[key] = String(value)
      }
    }
    return result
  }
  if (typeof addons === 'object') {
    for (const [key, value] of Object.entries(addons as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number') result[key.toLowerCase()] = String(value)
      else if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>
        if (record.version) result[key.toLowerCase()] = String(record.version)
      }
    }
  }
  return result
}

// ------------------------------------------------------------------ CurseForge 文件解析

interface CurseForgeFile {
  fileName?: string
  downloadUrl?: string | null
  fileLength?: number
  hashes?: { algo?: number; value?: string }[]
  displayName?: string
}

function curseForgeCdn(fileId: number, fileName: string): string {
  return `${CURSEFORGE_CDN}/${Math.floor(fileId / 1000)}/${fileId % 1000}/${encodeURIComponent(fileName)}`
}

function curseForgeMirrorCdn(fileId: number, fileName: string): string {
  return `${CURSEFORGE_MIRROR_CDN}/files/${Math.floor(fileId / 1000)}/${fileId % 1000}/${encodeURIComponent(fileName)}`
}

async function postJson<T>(urls: string[], body: unknown, apiKey: string | undefined): Promise<T> {
  const errors: string[] = []
  for (const url of urls) {
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'MineFlux/0.3.0',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }
      if (apiKey) headers['x-api-key'] = apiKey
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as T
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(`CurseForge 接口请求失败：${errors.join(' | ')}`)
}

async function resolveCurseForgeFiles(
  fileIds: number[],
  apiKey: string | undefined,
  log: ModpackInstallContext['log'],
): Promise<Map<number, CurseForgeFile>> {
  const result = new Map<number, CurseForgeFile>()
  if (!fileIds.length) return result
  const urls = apiKey ? [`${CURSEFORGE_API}/mods/files`, `${CURSEFORGE_MIRROR_API}/mods/files`] : [`${CURSEFORGE_MIRROR_API}/mods/files`, `${CURSEFORGE_API}/mods/files`]
  try {
    const data = await postJson<{ data?: CurseForgeFile[] }>(urls, { fileIds }, apiKey)
    for (const file of data.data ?? []) {
      const id = (file as CurseForgeFile & { id?: number }).id
      if (id) result.set(id, file)
    }
  } catch (error) {
    if (!apiKey) {
      log(
        'warn',
        'CurseForge 整合包需要 API Key：请在设置里填写 CurseForge API Key（或设置环境变量 MINEFLUX_CURSEFORGE_API_KEY）',
      )
    }
    throw error
  }
  return result
}

// ------------------------------------------------------------------ 安装

export async function installModpack(
  file: string,
  info: ModpackInfo,
  ctx: ModpackInstallContext,
): Promise<ModpackInstallResult> {
  const archive = await resolveArchive(file, ctx.log, ctx.tempDir)
  const { type } = detectModpackType(archive)
  const downloads: ModpackDownload[] = []
  const warnings: string[] = [...info.warnings]
  let extracted = 0

  const copyOverrides = async (dirName: string): Promise<void> => {
    if (!dirName) return
    const clean = dirName.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '')
    const prefix = `${archive.prefix}${clean ? `${clean}/` : ''}`
    const candidates = clean ? [prefix] : [archive.prefix]
    for (const candidate of candidates) {
      const hasAny = archive.entries.some(
        (entry) => entryName(entry).toLowerCase().startsWith(candidate.toLowerCase()),
      )
      if (!hasAny) continue
      extracted += await extractZip(archive.buffer, archive.entries, ctx.dataDir, {
        prefix: candidate,
        stripPrefix: candidate,
      })
    }
  }

  switch (type) {
    case 'modrinth': {
      const index = readJson<ModrinthIndex>(archive, 'modrinth.index.json')
      if (!index) throw new Error('Modrinth 整合包缺少有效的 modrinth.index.json')
      await copyOverrides('overrides')
      await copyOverrides('client-overrides')
      let optional = 0
      for (const item of index.files ?? []) {
        if (!item.path) continue
        if (item.env?.client === 'unsupported') continue
        if (item.env?.client === 'optional') optional++
        const sha1 = item.hashes?.sha1?.toLowerCase()
        downloads.push({
          relativePath: checkedRelativePath(ctx.dataDir, item.path),
          urls: item.downloads ?? [],
          sha1,
          size: item.size ?? -1,
          label: item.path,
        })
      }
      if (optional) ctx.log('info', `整合包中有 ${optional} 个可选客户端文件，已一并下载`)
      break
    }
    case 'curseforge': {
      const manifest = readJson<CurseForgeManifest>(archive, 'manifest.json')
      if (!manifest) throw new Error('CurseForge 整合包缺少 manifest.json')
      await copyOverrides(manifest.overrides || 'overrides')
      const entries = manifest.files ?? []
      const fileIds = entries.map((item) => item.fileID).filter((id): id is number => typeof id === 'number')
      const resolved = await resolveCurseForgeFiles(fileIds, ctx.curseforgeApiKey, ctx.log)
      let missing = 0
      let optional = 0
      for (const item of entries) {
        const fileId = item.fileID
        if (typeof fileId !== 'number') continue
        if (item.required === false) optional++
        const meta = resolved.get(fileId)
        if (!meta?.fileName) {
          missing++
          continue
        }
        const sha1 = meta.hashes?.find((hash) => hash.algo === 1)?.value?.toLowerCase()
        const urls: string[] = []
        if (meta.downloadUrl) urls.push(meta.downloadUrl)
        urls.push(curseForgeCdn(fileId, meta.fileName), curseForgeMirrorCdn(fileId, meta.fileName))
        const rel = checkedRelativePath(ctx.dataDir, `mods/${meta.fileName}`)
        downloads.push({
          relativePath: rel,
          urls,
          sha1,
          size: meta.fileLength ?? -1,
          label: meta.displayName ?? meta.fileName,
        })
      }
      if (missing) {
        warnings.push(`有 ${missing} 个 CurseForge 文件无法解析下载地址（可能已被删除或需要 API Key）`)
      }
      if (optional) ctx.log('info', `整合包中有 ${optional} 个可选文件，已一并下载`)
      break
    }
    case 'hmcl': {
      await copyOverrides('minecraft')
      break
    }
    case 'mmc': {
      const hasDot = archive.entries.some((entry) =>
        entryName(entry).toLowerCase().startsWith(`${archive.prefix}.minecraft/`),
      )
      await copyOverrides(hasDot ? '.minecraft' : 'minecraft')
      break
    }
    case 'mcbbs': {
      await copyOverrides('overrides')
      break
    }
    case 'compress': {
      // 直接把整个 .minecraft 解压到游戏目录
      const versionName = archive.entries
        .map(entryName)
        .find((name) => /(?:^|\/)versions\/[^/]+\/[^/]+\.json$/i.test(name))
      const prefix = versionName ? versionName.slice(0, versionName.search(/versions\//i)) : ''
      extracted += await extractZip(archive.buffer, archive.entries, ctx.root, {
        prefix,
        stripPrefix: prefix,
      })
      // 写入一个简单的安装记录，便于界面展示
      const versionId = versionName ? /versions\/([^/]+)\/\1\.json$/i.exec(versionName)?.[1] : undefined
      if (versionId) {
        await ensureDir(path.join(ctx.root, 'versions', ctx.instanceName))
        const manifest = {
          schema: 1,
          app: 'mineflux',
          instance: ctx.instanceName,
          mcVersion: versionId,
          components: {},
          isolation: ctx.dataDir === path.join(ctx.root, 'versions', ctx.instanceName),
          installedAt: Date.now(),
          fileCount: extracted,
          totalBytes: info.totalBytes,
          complete: true,
        }
        await writeJsonAtomic(path.join(ctx.root, 'versions', ctx.instanceName, 'mineflux-install.json'), manifest)
      }
      return { downloads: [], warnings, compressOnly: true, extracted }
    }
    case 'launcherpack':
      throw new Error('嵌套整合包解析失败')
    default:
      throw new Error(`暂不支持该整合包类型：${String(type)}`)
  }

  return { downloads, warnings, extracted }
}

/** 清单里的相对路径不可信：先确认它落在数据目录内，再返回规范化后的写法 */
function checkedRelativePath(baseDir: string, relative: string): string {
  try {
    safeJoin(baseDir, relative)
  } catch (error) {
    throw new Error(
      `整合包包含非法文件路径，已中止安装：${relative}（${error instanceof Error ? error.message : String(error)}）`,
    )
  }
  return relative.replace(/\\/g, '/')
}

/** 供界面展示：解压出来的目录需要确保存在 */
export async function ensureModpackDirs(dataDir: string, downloads: ModpackDownload[]): Promise<void> {
  await ensureDir(path.join(dataDir, 'mods'))
  for (const download of downloads) {
    const dir = path.dirname(safeJoin(dataDir, download.relativePath))
    await ensureDir(dir)
  }
}


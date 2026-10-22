/**
 * Forge / NeoForge 加载器。
 * 对应 PCL 的 `McDownloadForgelikeLoader()`：
 *  - 旧版（Forge < 20，如 1.12.2）直接从安装器 zip 里取 install_profile.json / version.json / maven 目录，不需要 Java；
 *  - 新版（Forge 20+ / 所有 NeoForge）必须运行官方安装器的 `--installClient`，由安装器生成补丁后的版本 JSON 与库文件。
 */
import path from 'node:path'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import { getJsonFromSources } from '../http'
import { BMCLAPI } from '../mirror'
import { readVersionJson, type RawVersion } from '../version-json'
import { openZip, readZipText, readZipEntry, type ZipEntry } from '../zip'
import {
  FORGE_LIST_MIRROR,
  FORGE_MAVEN,
  FORGE_METADATA,
  FORGE_PROMOTIONS,
  NEOFORGE_API,
  NEOFORGE_API_LEGACY,
  NEOFORGE_MAVEN,
  NEOFORGE_MIRROR_API,
  mirroredMaven,
} from './sources'
import type { LoaderContext, LoaderListOptions, LoaderListResult, LoaderResult } from './types'

function forgeVersionFromMetadata(item: string, mcVersion: string): string {
  return item.startsWith(`${mcVersion}-`) ? item.slice(mcVersion.length + 1) : item
}

/** Forge 版本列表：官方 maven-metadata.json + promotions_slim.json，镜像兜底 */
export async function listForge(options: LoaderListOptions): Promise<LoaderListResult> {
  let entries: { version: string; label: string }[] = []
  let source = 'Forge 官方'
  try {
    const { data } = await getJsonFromSources<Record<string, string[]>>(
      [FORGE_METADATA, `${BMCLAPI}/forge/maven-metadata.json`],
      { signal: options.signal, timeoutMs: 30_000 },
    )
    const raw = data[options.mcVersion] ?? []
    entries = raw.map((item) => ({
      version: forgeVersionFromMetadata(item, options.mcVersion),
      label: item,
    }))
  } catch (error) {
    source = 'BMCLAPI'
    const { data } = await getJsonFromSources<{ version?: string; mcversion?: string }[]>(
      [FORGE_LIST_MIRROR(options.mcVersion)],
      { signal: options.signal, timeoutMs: 30_000 },
    )
    entries = data
      .filter((item) => item.mcversion === options.mcVersion && item.version)
      .map((item) => ({ version: item.version as string, label: `${options.mcVersion}-${item.version}` }))
    options.signal?.throwIfAborted()
    if (!entries.length) throw error
  }
  let recommended: string | undefined
  try {
    const { data } = await getJsonFromSources<{ promos?: Record<string, string> }>(
      [FORGE_PROMOTIONS],
      { signal: options.signal, timeoutMs: 15_000 },
    )
    recommended = data.promos?.[`${options.mcVersion}-recommended`]
  } catch {
    // 拿不到推荐版本不影响列表
  }
  const versions = entries
    .map((entry) => ({
      version: entry.version,
      label: entry.label,
      recommended: entry.version === recommended,
    }))
    .reverse()
  return {
    id: 'forge',
    label: 'Forge',
    versions,
    source,
    requiresJava: true,
    note: versions.length ? undefined : '该 Minecraft 版本没有可用的 Forge',
  }
}

/** NeoForge 版本号 -> 对应的 Minecraft 版本 */
export function neoForgeMcVersion(version: string): string | null {
  if (/^1\.20\.1-/.test(version)) return '1.20.1'
  const match = /^(\d+)\.(\d+)\./.exec(version)
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  if (!Number.isFinite(major) || major < 20) return null
  return minor === 0 ? `1.${major}` : `1.${major}.${minor}`
}

function neoforgeArtifact(version: string): 'neoforge' | 'forge' {
  return /^1\.\d+\.\d+-/.test(version) ? 'forge' : 'neoforge'
}

export async function listNeoForge(options: LoaderListOptions): Promise<LoaderListResult> {
  const sources = [NEOFORGE_MIRROR_API('neoforge'), NEOFORGE_API]
  let names: string[] = []
  let source = 'BMCLAPI'
  try {
    const { data } = await getJsonFromSources<{ files?: { name?: string; type?: string }[] }>(
      [NEOFORGE_MIRROR_API('neoforge')],
      { signal: options.signal, timeoutMs: 30_000 },
    )
    names = (data.files ?? []).filter((item) => item.type === 'DIRECTORY' && item.name).map((item) => item.name as string)
  } catch {
    source = 'NeoForge 官方'
    const { data } = await getJsonFromSources<{ versions?: string[] }>(sources.slice(1), {
      signal: options.signal,
      timeoutMs: 30_000,
    })
    names = data.versions ?? []
  }
  let legacy: string[] = []
  if (options.mcVersion === '1.20.1') {
    try {
      const { data } = await getJsonFromSources<{ files?: { name?: string; type?: string }[] }>(
        [NEOFORGE_MIRROR_API('forge')],
        { signal: options.signal, timeoutMs: 20_000 },
      )
      legacy = (data.files ?? [])
        .filter((item) => item.type === 'DIRECTORY' && item.name?.startsWith('1.20.1-'))
        .map((item) => item.name as string)
    } catch {
      try {
        const { data } = await getJsonFromSources<{ versions?: string[] }>([NEOFORGE_API_LEGACY], {
          signal: options.signal,
          timeoutMs: 20_000,
        })
        legacy = (data.versions ?? []).filter((item) => item.startsWith('1.20.1-'))
      } catch {
        // 忽略
      }
    }
  }
  const all = [...new Set([...names, ...legacy])]
    .filter((item) => neoForgeMcVersion(item) === options.mcVersion && item !== '47.1.82')
    .sort(compareVersionsDesc)
  const versions = all.map((item) => ({
    version: item,
    label: item,
    stable: !/-(beta|alpha)/.test(item),
    recommended: false,
  }))
  return {
    id: 'neoforge',
    label: 'NeoForge',
    versions,
    source,
    requiresJava: true,
    note: versions.length ? undefined : '该 Minecraft 版本没有可用的 NeoForge',
  }
}

function compareVersionsDesc(a: string, b: string): number {
  return b.localeCompare(a, 'en', { numeric: true })
}

/** 读取安装器里的 JSON 文本 */
function zipJson(buffer: Buffer, entries: ZipEntry[], name: string): RawVersion | null {
  const text = readZipText(buffer, entries, name)
  if (!text) return null
  try {
    return JSON.parse(text) as RawVersion
  } catch {
    return null
  }
}

async function ensureLauncherProfiles(root: string): Promise<void> {
  const file = path.join(root, 'launcher_profiles.json')
  if (fs.existsSync(file)) return
  await fsp.writeFile(
    file,
    JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2),
    'utf8',
  )
}

async function listVersionFolders(root: string): Promise<string[]> {
  try {
    return (await fsp.readdir(path.join(root, 'versions'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** 运行安装器并读取它生成的版本 JSON（PCL「方式 A」） */
async function runInstallerAndReadProfile(
  ctx: LoaderContext,
  jarPath: string,
  label: string,
): Promise<RawVersion> {
  await ensureLauncherProfiles(ctx.root)
  const before = new Set(await listVersionFolders(ctx.root))
  ctx.log('info', `开始运行 ${label} 安装器（--installClient）`)
  await ctx.runInstaller(['-jar', jarPath, '--installClient', ctx.root], { minJava: 8 })
  const after = await listVersionFolders(ctx.root)
  const added = after.filter((name) => !before.has(name))
  const candidates = added.filter((name) =>
    fs.existsSync(path.join(ctx.root, 'versions', name, `${name}.json`)),
  )
  if (!candidates.length) {
    throw new Error(`${label} 安装器运行完成，但没有找到生成的版本 JSON`)
  }
  const folder = candidates[0]
  const jsonPath = path.join(ctx.root, 'versions', folder, `${folder}.json`)
  const profile = await readVersionJson(jsonPath)
  if (!profile) throw new Error(`${label} 安装器生成的版本 JSON 无法解析：${jsonPath}`)
  ctx.log('info', `${label} 安装器生成版本：${folder}`)
  // 生成的版本文件夹只是中间产物，实例 JSON 会合并进目标实例
  await fsp.rm(path.join(ctx.root, 'versions', folder), { recursive: true, force: true })
  return profile
}

function forgeInstallerUrls(mcVersion: string, version: string, mode: 'auto' | 'official' | 'mirror'): string[] {
  const artifacts = [`${mcVersion}-${version}`]
  const underscored = mcVersion.replace(/-/g, '_')
  if (underscored !== mcVersion) artifacts.push(`${underscored}-${version}`)
  const urls: string[] = []
  for (const artifact of artifacts) {
    const relative = `${artifact}/forge-${artifact}-installer.jar`
    urls.push(...mirroredMaven(`${FORGE_MAVEN}/net/minecraftforge/forge/${relative}`, mode))
  }
  return urls
}

export async function prepareForge(version: string, ctx: LoaderContext): Promise<LoaderResult> {
  const jarPath = path.join(ctx.tempDir, `forge-${version}-installer.jar`)
  await ctx.fetchFile(forgeInstallerUrls(ctx.mcVersion, version, ctx.mode), jarPath, {
    minSize: 100 * 1024,
    label: 'Forge 安装器',
  })
  const zip = await openZip(jarPath)
  const installProfileText = readZipText(zip.buffer, zip.entries, 'install_profile.json')
  if (!installProfileText) throw new Error('Forge 安装器缺少 install_profile.json')
  const installProfile = JSON.parse(installProfileText) as {
    install?: { filePath?: string; path?: string }
    versionInfo?: RawVersion
    json?: string
    spec?: number
    processors?: unknown[]
    data?: Record<string, unknown>
    version?: string
  }

  // PCL 用 Forge 主版本号判断安装方式：< 20（≤ 1.12.2）解包安装器，≥ 20（1.13+）运行安装器
  const forgeMajor = Number.parseInt(version.split('.')[0] ?? '', 10)
  const legacy = Number.isFinite(forgeMajor) && forgeMajor < 20

  if (legacy) {
    if (installProfile.json) {
      const profile = zipJson(zip.buffer, zip.entries, installProfile.json.replace(/^\/+/, ''))
      if (!profile) throw new Error('无法从 Forge 安装器读取 version.json')
      // 极老版本的配套库放在 maven/ 目录里
      const mavenFiles = zip.entries.filter((entry) => entry.name.startsWith('maven/') && !entry.isDirectory)
      for (const entry of mavenFiles) {
        const relative = entry.name.slice('maven/'.length)
        const dest = path.join(ctx.root, 'libraries', relative)
        await fsp.mkdir(path.dirname(dest), { recursive: true })
        await fsp.writeFile(dest, readZipEntry(zip.buffer, entry))
      }
      if (mavenFiles.length) ctx.log('info', `已释放 ${mavenFiles.length} 个 Forge 自带库文件`)
      return { id: 'forge', version, profile }
    }
    if (installProfile.versionInfo) {
      const filePath = installProfile.install?.filePath
      if (filePath) {
        const entry = zip.entries.find(
          (item) => item.name === filePath || item.name.endsWith(filePath) || item.name === `maven/${filePath}`,
        )
        if (entry) {
          const dest = path.join(ctx.root, 'libraries', filePath)
          await fsp.mkdir(path.dirname(dest), { recursive: true })
          await fsp.writeFile(dest, readZipEntry(zip.buffer, entry))
          ctx.log('info', `已释放 Forge 本体：libraries/${filePath}`)
        } else {
          ctx.log('warn', `安装器内未找到 ${filePath}，将由下载清单补齐`)
        }
      }
      return { id: 'forge', version, profile: installProfile.versionInfo }
    }
    throw new Error('无法识别的 Forge 安装器格式')
  }

  // 新版 Forge（1.13+）：必须运行安装器
  const profile = await runInstallerAndReadProfile(ctx, jarPath, `Forge ${version}`)
  return { id: 'forge', version, profile }
}

export async function prepareNeoForge(version: string, ctx: LoaderContext): Promise<LoaderResult> {
  const artifact = neoforgeArtifact(version)
  const relative =
    artifact === 'forge'
      ? `net/neoforged/forge/${version}/forge-${version}-installer.jar`
      : `net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`
  const jarPath = path.join(ctx.tempDir, `neoforge-${version}-installer.jar`)
  await ctx.fetchFile(
    mirroredMaven(`${NEOFORGE_MAVEN}/releases/${relative}`, ctx.mode),
    jarPath,
    { minSize: 100 * 1024, label: 'NeoForge 安装器' },
  )
  const profile = await runInstallerAndReadProfile(ctx, jarPath, `NeoForge ${version}`)
  return { id: 'neoforge', version, profile }
}

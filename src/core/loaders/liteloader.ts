/**
 * LiteLoader 加载器。
 * 对应 PCL 的 `McDownloadLiteLoaderLoader()`：不需要安装器，
 * 直接用 versions.json 里的元数据拼出一个继承原版的版本 JSON。
 */
import { getJsonFromSources } from '../http'
import type { RawLibrary } from '../version-json'
import { LITELOADER_MAVEN, LITELOADER_VERSIONS } from './sources'
import type { LoaderContext, LoaderListOptions, LoaderListResult, LoaderResult } from './types'

interface LiteLoaderBuild {
  tweakClass?: string
  libraries?: RawLibrary[]
  stream?: string
  file?: string
  version?: string
  build?: string
  timestamp?: string
  md5?: string
}

interface LiteLoaderMcEntry {
  repo?: { url?: string }
  snapshots?: Record<string, unknown>
  artefacts?: Record<string, unknown>
  [key: string]: unknown
}

interface LiteLoaderVersions {
  versions?: Record<string, LiteLoaderMcEntry>
}

/** LiteLoader 只有官方源且偶尔 5xx，做三次短重试 */
async function fetchVersions(signal?: AbortSignal): Promise<LiteLoaderVersions> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data } = await getJsonFromSources<LiteLoaderVersions>([LITELOADER_VERSIONS], {
        signal,
        timeoutMs: 30_000,
      })
      return data
    } catch (error) {
      lastError = error
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function pickBuilds(entry: LiteLoaderMcEntry | undefined): LiteLoaderBuild[] {
  if (!entry) return []
  const containers: unknown[] = []
  for (const key of ['com.mumfrey:liteloader', 'snapshots', 'artefacts']) {
    const value = entry[key]
    if (value) containers.push(value)
  }
  const builds: LiteLoaderBuild[] = []
  for (const container of containers) {
    if (!container || typeof container !== 'object') continue
    const record = container as Record<string, unknown>
    // 形如 { "com.mumfrey:liteloader": { hash: {...}, latest: {...} } }
    const nested = record['com.mumfrey:liteloader']
    if (nested && typeof nested === 'object') {
      for (const value of Object.values(nested as Record<string, LiteLoaderBuild>)) {
        if (value && typeof value === 'object' && (value as LiteLoaderBuild).version) builds.push(value)
      }
      continue
    }
    // 形如 { hash: {...}, latest: {...} }
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object' && (value as LiteLoaderBuild).version) {
        builds.push(value as LiteLoaderBuild)
      }
    }
  }
  return builds
}

function latestBuild(entry: LiteLoaderMcEntry | undefined): LiteLoaderBuild | null {
  const builds = pickBuilds(entry)
  if (!builds.length) return null
  return builds.sort((a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0))[0]
}

export async function listLiteLoader(options: LoaderListOptions): Promise<LoaderListResult> {
  const data = await fetchVersions(options.signal)
  const build = latestBuild(data.versions?.[options.mcVersion])
  const versions = build?.version
    ? [
        {
          version: build.version,
          label: `${build.version}（${build.stream ?? 'RELEASE'}）`,
          stable: (build.stream ?? '').toUpperCase() !== 'SNAPSHOT',
          recommended: true,
          releaseTime: build.timestamp
            ? new Date(Number(build.timestamp) * 1000).toISOString()
            : undefined,
        },
      ]
    : []
  return {
    id: 'liteloader',
    label: 'LiteLoader',
    versions,
    source: 'LiteLoader 官方',
    note: versions.length ? undefined : '该 Minecraft 版本没有可用的 LiteLoader',
  }
}

export async function prepareLiteLoader(
  version: string,
  ctx: LoaderContext,
): Promise<LoaderResult> {
  const data = await fetchVersions(ctx.signal)
  const build = pickBuilds(data.versions?.[ctx.mcVersion]).find((item) => item.version === version)
  if (!build) throw new Error(`LiteLoader 版本 ${version} 不在 ${ctx.mcVersion} 的版本列表中`)
  const instanceName = `${ctx.mcVersion}-LiteLoader`
  const timestamp = build.timestamp ? new Date(Number(build.timestamp) * 1000).toISOString() : undefined
  const libraries = [...(build.libraries ?? [])]
  libraries.push({ name: `com.mumfrey:liteloader:${build.version}`, url: LITELOADER_MAVEN })
  const profile = {
    id: instanceName,
    inheritsFrom: ctx.mcVersion,
    type: 'release',
    time: timestamp,
    releaseTime: timestamp,
    mainClass: 'net.minecraft.launchwrapper.Launch',
    arguments: { game: ['--tweakClass', build.tweakClass ?? 'com.mumfrey.liteloader.launch.LiteLoaderTweaker'] },
    libraries,
    minimumLauncherVersion: 18,
  }
  ctx.log('info', `LiteLoader ${version} 用于 ${ctx.mcVersion}（构建 ${build.build ?? version}）`)
  return { id: 'liteloader', version, profile }
}

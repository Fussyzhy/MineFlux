/**
 * Fabric / Quilt 加载器。
 * 两者都是「拉取 profile JSON」即可完成安装，不需要运行任何安装器。
 * 对应 PCL 的 `McDownloadFabricLoader()`。
 */
import { getJsonFromSources } from '../http'
import type { RawVersion } from '../version-json'
import { fabricUrls, quiltUrls } from './sources'
import type { LoaderContext, LoaderListOptions, LoaderListResult, LoaderResult, LoaderVersionEntry } from './types'

interface FabricLoaderEntry {
  loader?: { version?: string; stable?: boolean }
}

interface QuiltLoaderEntry {
  loader?: { version?: string }
  hashes?: unknown
}

export async function listFabric(options: LoaderListOptions): Promise<LoaderListResult> {
  const { data } = await getJsonFromSources<FabricLoaderEntry[]>(
    fabricUrls(`/v2/versions/loader/${options.mcVersion}`, options.mode),
    { signal: options.signal, timeoutMs: 30_000 },
  )
  const versions: LoaderVersionEntry[] = data
    .map((entry) => ({
      version: entry.loader?.version ?? '',
      label: entry.loader?.version ?? '',
      stable: entry.loader?.stable === true,
    }))
    .filter((entry) => entry.version)
  const firstStable = versions.find((entry) => entry.stable)
  if (firstStable) firstStable.recommended = true
  return {
    id: 'fabric',
    label: 'Fabric',
    versions,
    source: 'Fabric Meta',
    note: versions.length ? undefined : '该 Minecraft 版本没有可用的 Fabric 加载器',
  }
}

export async function prepareFabric(
  version: string,
  ctx: LoaderContext,
): Promise<LoaderResult> {
  const { data } = await getJsonFromSources<RawVersion>(
    fabricUrls(
      `/v2/versions/loader/${ctx.mcVersion}/${version}/profile/json`,
      ctx.mode,
    ),
    { signal: ctx.signal, timeoutMs: 30_000 },
  )
  ctx.log('info', `Fabric ${version} 用于 ${ctx.mcVersion}：${data.id ?? 'profile'}`)
  return { id: 'fabric', version, profile: data }
}

export async function listQuilt(options: LoaderListOptions): Promise<LoaderListResult> {
  const { data } = await getJsonFromSources<QuiltLoaderEntry[]>(
    quiltUrls(`/v2/versions/loader/${options.mcVersion}`),
    { signal: options.signal, timeoutMs: 30_000 },
  )
  const versions: LoaderVersionEntry[] = data
    .map((entry) => {
      const value = entry.loader?.version ?? ''
      return { version: value, label: value, stable: !value.includes('-') }
    })
    .filter((entry) => entry.version)
  const firstStable = versions.find((entry) => entry.stable)
  if (firstStable) firstStable.recommended = true
  return {
    id: 'quilt',
    label: 'Quilt',
    versions,
    source: 'Quilt Meta',
    note: versions.length ? undefined : '该 Minecraft 版本没有可用的 Quilt 加载器',
  }
}

export async function prepareQuilt(version: string, ctx: LoaderContext): Promise<LoaderResult> {
  const { data } = await getJsonFromSources<RawVersion>(
    quiltUrls(`/v2/versions/loader/${ctx.mcVersion}/${version}/profile/json`),
    { signal: ctx.signal, timeoutMs: 30_000 },
  )
  ctx.log('info', `Quilt ${version} 用于 ${ctx.mcVersion}：${data.id ?? 'profile'}`)
  return { id: 'quilt', version, profile: data }
}



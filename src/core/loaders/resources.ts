/**
 * 通过 Modrinth 解析「作为 Mod 安装」的资源（Fabric API / OptiFabric）。
 * 对应 PCL 里 `McInstallLoadersGet` 中 `FabricApi` / `OptiFabric` 的处理。
 */
import { getJsonFromSources } from '../http'
import { modrinthUrls } from './sources'
import type { LoaderContext } from './types'
import type { ModVersionList } from '../../shared/types'

export interface ResolvedModFile {
  slug: string
  filename: string
  url: string
  sha1: string
  size: number
  versionName: string
}

interface ModrinthVersion {
  version_number?: string
  date_published?: string
  files?: {
    url?: string
    filename?: string
    primary?: boolean
    size?: number
    hashes?: { sha1?: string }
  }[]
}

export async function resolveModrinthMod(  slug: string,
  mcVersion: string,
  loaders: string[],
  ctx: LoaderContext,
): Promise<ResolvedModFile | null> {
  const query =
    `/project/${slug}/version?game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}` +
    `&loaders=${encodeURIComponent(JSON.stringify(loaders))}`
  try {
    const { data } = await getJsonFromSources<ModrinthVersion[]>(
      modrinthUrls(query, ctx.mode),
      { signal: ctx.signal, timeoutMs: 30_000 },
    )
    if (!data.length) return null
    const version = data[0]
    const file = version.files?.find((item) => item.primary) ?? version.files?.[0]
    if (!file?.url || !file.filename) return null
    return {
      slug,
      filename: file.filename,
      url: file.url,
      sha1: (file.hashes?.sha1 ?? '').toLowerCase(),
      size: file.size ?? -1,
      versionName: version.version_number ?? '',
    }
  } catch (error) {
    ctx.log(
      'warn',
      `从 Modrinth 获取 ${slug} 失败：${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

/** 只查询 Fabric API / OptiFabric 的版本列表（详细配置页展示用，不下载） */
export async function listModrinthModVersions(
  slug: string,
  mcVersion: string,
  loaders: string[],
  mode: 'auto' | 'official' | 'mirror',
): Promise<ModVersionList> {
  const query =
    `/project/${slug}/version?game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}` +
    `&loaders=${encodeURIComponent(JSON.stringify(loaders))}`
  const { data, url } = await getJsonFromSources<ModrinthVersion[]>(modrinthUrls(query, mode), {
    timeoutMs: 30_000,
  })
  const versions = (Array.isArray(data) ? data : [])
    .map((item) => {
      const file = item.files?.find((entry) => entry.primary) ?? item.files?.[0]
      return {
        version: item.version_number ?? '',
        filename: file?.filename ?? '',
        releaseTime: item.date_published,
      }
    })
    .filter((item) => item.version)
    .slice(0, 40)
  return { versions, source: url.includes('modrinth.com') ? 'Modrinth' : 'Modrinth 镜像' }
}

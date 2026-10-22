import type { SourceMode, VersionListResult, VersionSummary } from '../shared/types'
import { getJsonFromSources } from './http'
import { BMCLAPI_MANIFEST, versionListUrls } from './mirror'

interface RawManifest {
  latest?: { release?: string; snapshot?: string }
  versions?: Array<{
    id?: string
    type?: string
    url?: string
    time?: string
    releaseTime?: string
    sha1?: string
    complianceLevel?: number
  }>
}

/** 版本清单最少条目数，用于识别「看起来成功但内容被截断/被劫持」的响应（PCL 也做同样检查） */
const MIN_VERSION_COUNT = 200

export async function fetchVersionManifest(
  mode: SourceMode,
  signal?: AbortSignal,
): Promise<VersionListResult> {
  const urls = versionListUrls(mode)
  const { data, url } = await getJsonFromSources<RawManifest>(urls, {
    signal,
    timeoutMs: 30_000,
  })
  const rawVersions = data.versions
  if (!Array.isArray(rawVersions) || rawVersions.length < MIN_VERSION_COUNT) {
    throw new Error(
      `版本清单异常：只拿到 ${Array.isArray(rawVersions) ? rawVersions.length : 0} 个版本（期望至少 ${MIN_VERSION_COUNT} 个）`,
    )
  }
  const versions: VersionSummary[] = []
  for (const item of rawVersions) {
    if (!item?.id || !item.url) continue
    versions.push({
      id: item.id,
      type: item.type ?? 'release',
      url: item.url,
      releaseTime: item.releaseTime ?? item.time ?? '',
      sha1: item.sha1,
      complianceLevel: item.complianceLevel,
    })
  }
  const isMirror = url.includes('bmclapi')
  return {
    source: isMirror ? 'bmclapi' : 'mojang',
    sourceLabel: isMirror ? 'BMCLAPI 镜像' : 'Mojang 官方',
    fetchedAt: Date.now(),
    latest: {
      release: data.latest?.release,
      snapshot: data.latest?.snapshot,
    },
    versions,
  }
}

export function describeManifestUrl(mode: SourceMode): string {
  return versionListUrls(mode)[0] === BMCLAPI_MANIFEST ? 'BMCLAPI 镜像' : 'Mojang 官方'
}

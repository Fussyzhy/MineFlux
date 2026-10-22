import type { SourceMode } from '../shared/types'

export const BMCLAPI = 'https://bmclapi2.bangbang93.com'
export const MOJANG_MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest.json'
export const BMCLAPI_MANIFEST = `${BMCLAPI}/mc/game/version_manifest.json`

const MOJANG_HOSTS = [
  'https://piston-data.mojang.com',
  'https://piston-meta.mojang.com',
  'https://launcher.mojang.com',
  'https://launchermeta.mojang.com',
  'http://piston-data.mojang.com',
  'http://piston-meta.mojang.com',
  'http://launcher.mojang.com',
  'http://launchermeta.mojang.com',
]

const ASSET_HOST = 'https://resources.download.minecraft.net'
const LIBRARY_HOSTS = ['https://libraries.minecraft.net', 'http://libraries.minecraft.net']

function dedupe(urls: string[]): string[] {
  const out: string[] = []
  for (const url of urls) {
    if (!url) continue
    if (!out.includes(url)) out.push(url)
  }
  return out
}

/** 把官方地址映射到 BMCLAPI 对应路径（对应 PCL 的 DlSourceLauncherOrMetaGet） */
function toMirrorMeta(url: string): string {
  let out = url
  for (const host of MOJANG_HOSTS) out = out.split(host).join(BMCLAPI)
  return out
}

/** 库文件镜像：BMCLAPI 同时提供 /maven 与 /libraries 两套前缀，两个都当作候选 */
function toMirrorLibraries(url: string): string[] {
  const bases = [`${BMCLAPI}/maven`, `${BMCLAPI}/libraries`]
  const out: string[] = []
  for (const base of bases) {
    let candidate = url
    for (const host of MOJANG_HOSTS) candidate = candidate.split(host).join(base)
    for (const host of LIBRARY_HOSTS) candidate = candidate.split(host).join(base)
    out.push(candidate)
  }
  return out
}

/** 资源文件镜像（对应 PCL 的 DlSourceAssetsGet） */
function toMirrorAsset(url: string): string {
  let out = url.replace(/^http:\/\/resources\.download\.minecraft\.net/, ASSET_HOST)
  for (const host of MOJANG_HOSTS) out = out.split(host).join(`${BMCLAPI}/assets`)
  out = out.split(ASSET_HOST).join(`${BMCLAPI}/assets`)
  return out
}

function order(mode: SourceMode, official: string[], mirror: string[]): string[] {
  const list = mode === 'official' ? [...official, ...mirror] : [...mirror, ...official]
  return dedupe(list.filter(Boolean))
}

/** 版本清单地址（对应 PCL 的 DlClientListMain，auto 时镜像优先） */
export function versionListUrls(mode: SourceMode): string[] {
  if (mode === 'mirror') return [BMCLAPI_MANIFEST]
  if (mode === 'official') return [MOJANG_MANIFEST, BMCLAPI_MANIFEST]
  return [BMCLAPI_MANIFEST, MOJANG_MANIFEST]
}

/** 版本 json / 客户端 jar / 资源索引等 meta 类文件 */
export function metaUrls(url: string, mode: SourceMode): string[] {
  const mirror = toMirrorMeta(url)
  if (mode === 'mirror') return [mirror]
  return order(mode, [url], mirror === url ? [] : [mirror])
}

/** libraries/ 下的文件 */
export function libraryUrls(url: string, mode: SourceMode): string[] {
  const mirrors = toMirrorLibraries(url).filter((u) => u !== url)
  if (mode === 'mirror') return mirrors.length ? mirrors : [url]
  return order(mode, [url], mirrors)
}

/** assets/objects 下的文件 */
export function assetUrls(url: string, mode: SourceMode): string[] {
  const mirror = toMirrorAsset(url)
  if (mode === 'mirror') return [mirror]
  return order(mode, [url], mirror === url ? [] : [mirror])
}

/** 资源对象的规范地址（index 里只有 hash，没有 url） */
export function assetObjectUrl(hash: string): string {
  return `${ASSET_HOST}/${hash.slice(0, 2)}/${hash}`
}

export function describeSource(mode: SourceMode): string {
  switch (mode) {
    case 'official':
      return '官方源优先'
    case 'mirror':
      return '仅镜像源 (BMCLAPI)'
    default:
      return '镜像源优先 (BMCLAPI)'
  }
}

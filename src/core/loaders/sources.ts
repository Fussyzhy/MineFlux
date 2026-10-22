/**
 * 各种加载器 / 资源站点的地址构造。
 * 镜像映射沿用 PCL 的规则：bmclapi2 放在前面作为优先源，官方源兜底。
 */
import { BMCLAPI } from '../mirror'

export const FABRIC_META = 'https://meta.fabricmc.net'
export const FABRIC_MIRROR = `${BMCLAPI}/fabric-meta`
export const QUILT_META = 'https://meta.quiltmc.org'

export const FORGE_MAVEN = 'https://maven.minecraftforge.net'
export const FORGE_MIRROR = `${BMCLAPI}/maven`
export const FORGE_METADATA = 'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json'
export const FORGE_PROMOTIONS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
export const FORGE_LIST_MIRROR = (mc: string): string => `${BMCLAPI}/forge/minecraft/${mc}`

export const NEOFORGE_MAVEN = 'https://maven.neoforged.net'
export const NEOFORGE_API = `${NEOFORGE_MAVEN}/api/maven/versions/releases/net/neoforged/neoforge`
export const NEOFORGE_API_LEGACY = `${NEOFORGE_MAVEN}/api/maven/versions/releases/net/neoforged/forge`
export const NEOFORGE_MIRROR_API = (artifact: 'neoforge' | 'forge'): string =>
  `${BMCLAPI}/neoforge/meta/api/maven/details/releases/net/neoforged/${artifact}`

export const LITELOADER_VERSIONS = 'https://dl.liteloader.com/versions/versions.json'
export const LITELOADER_MAVEN = 'https://dl.liteloader.com/versions/'

export const OPTIFINE_LIST_MIRROR = `${BMCLAPI}/optifine/versionList`
export const OPTIFINE_DOWNLOAD_MIRROR = `${BMCLAPI}/optifine`

export const MODRINTH_API = 'https://api.modrinth.com/v2'
export const MODRINTH_MIRROR = 'https://mod.mcimirror.top/modrinth/v2'
export const CURSEFORGE_API = 'https://api.curseforge.com/v1'
export const CURSEFORGE_MIRROR_API = 'https://mod.mcimirror.top/curseforge/v1'
export const CURSEFORGE_CDN = 'https://edge.forgecdn.net/files'
export const CURSEFORGE_MIRROR_CDN = 'https://mod.mcimirror.top'

/** fabric / quilt 的 meta 请求地址（镜像优先） */
export function fabricUrls(pathname: string, mode: 'auto' | 'official' | 'mirror'): string[] {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  return mode === 'mirror'
    ? [`${FABRIC_MIRROR}${path}`]
    : mode === 'official'
      ? [`${FABRIC_META}${path}`, `${FABRIC_MIRROR}${path}`]
      : [`${FABRIC_MIRROR}${path}`, `${FABRIC_META}${path}`]
}

export function quiltUrls(pathname: string): string[] {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  return [`${QUILT_META}${path}`]
}

/** modrinth v2 接口（镜像优先） */
export function modrinthUrls(pathname: string, mode: 'auto' | 'official' | 'mirror'): string[] {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  return mode === 'mirror'
    ? [`${MODRINTH_MIRROR}${path}`]
    : mode === 'official'
      ? [`${MODRINTH_API}${path}`, `${MODRINTH_MIRROR}${path}`]
      : [`${MODRINTH_MIRROR}${path}`, `${MODRINTH_API}${path}`]
}

/** 把 maven 地址换到 BMCLAPI 镜像 */
export function mavenMirror(url: string): string {
  return url
    .replace('https://maven.minecraftforge.net', FORGE_MIRROR)
    .replace('https://maven.neoforged.net/releases', FORGE_MIRROR)
    .replace('https://maven.fabricmc.net', `${BMCLAPI}/maven`)
}

/** 同一个 maven 文件的「镜像优先」地址列表 */
export function mirroredMaven(url: string, mode: 'auto' | 'official' | 'mirror'): string[] {
  const mirror = mavenMirror(url)
  if (mirror === url) return [url]
  if (mode === 'mirror') return [mirror]
  if (mode === 'official') return [url, mirror]
  return [mirror, url]
}

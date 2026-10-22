/**
 * 安装器注册表：对外只暴露「列出可用版本」和「准备安装」两个动作。
 */
import { listFabric, prepareFabric, listQuilt, prepareQuilt } from './fabric'
import { listForge, prepareForge, listNeoForge, prepareNeoForge } from './forge'
import { listLiteLoader, prepareLiteLoader } from './liteloader'
import { listOptiFine, prepareOptiFine } from './optifine'
import type { LoaderContext, LoaderId, LoaderListOptions, LoaderListResult, LoaderResult } from './types'

export type { LoaderContext, LoaderId, LoaderListOptions, LoaderListResult, LoaderResult } from './types'

export const LOADER_LABELS: Record<LoaderId, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  liteloader: 'LiteLoader',
  optifine: 'OptiFine',
}

/** 同一时间只能装一个的加载器（Fabric/Quilt 互斥，Forge/NeoForge 互斥） */
export const LOADER_GROUPS: Record<LoaderId, string> = {
  fabric: 'mod-loader',
  quilt: 'mod-loader',
  forge: 'forgelike',
  neoforge: 'forgelike',
  liteloader: 'liteloader',
  optifine: 'optifine',
}

export async function listLoaderVersions(
  id: LoaderId,
  options: LoaderListOptions,
): Promise<LoaderListResult> {
  switch (id) {
    case 'fabric':
      return listFabric(options)
    case 'quilt':
      return listQuilt(options)
    case 'forge':
      return listForge(options)
    case 'neoforge':
      return listNeoForge(options)
    case 'liteloader':
      return listLiteLoader(options)
    case 'optifine':
      return listOptiFine(options)
    default:
      throw new Error(`未知的加载器：${String(id)}`)
  }
}

export async function prepareLoader(
  id: LoaderId,
  version: string,
  ctx: LoaderContext,
): Promise<LoaderResult> {
  switch (id) {
    case 'fabric':
      return prepareFabric(version, ctx)
    case 'quilt':
      return prepareQuilt(version, ctx)
    case 'forge':
      return prepareForge(version, ctx)
    case 'neoforge':
      return prepareNeoForge(version, ctx)
    case 'liteloader':
      return prepareLiteLoader(version, ctx)
    case 'optifine':
      return prepareOptiFine(version, ctx)
    default:
      throw new Error(`未知的加载器：${String(id)}`)
  }
}

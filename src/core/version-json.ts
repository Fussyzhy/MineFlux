/**
 * 版本 JSON 的获取、继承链解析与合并。
 * 对应 PCL 的 `ModMinecraft` 版本 JSON 处理 + `MergeJson()`。
 */
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { getTextFromSources } from './http'
import { metaUrls } from './mirror'
import type { SourceMode } from '../shared/types'

export interface RawArtifact {
  path?: string
  sha1?: string
  size?: number
  url?: string
}

export interface RawLibrary {
  name?: string
  downloads?: {
    artifact?: RawArtifact
    classifiers?: Record<string, RawArtifact>
  }
  natives?: Record<string, string>
  rules?: unknown
  extract?: { exclude?: string[] }
  /** 部分第三方库直接给 maven base url，没有 downloads 节点 */
  url?: string
}

export interface RawAssetIndex {
  id?: string
  sha1?: string
  size?: number
  totalSize?: number
  url?: string
}

export interface RawArguments {
  game?: unknown[]
  jvm?: unknown[]
}

export interface RawVersion {
  id?: string
  type?: string
  inheritsFrom?: string
  jar?: string
  mainClass?: string
  assets?: string
  assetIndex?: RawAssetIndex
  downloads?: {
    client?: RawArtifact
    server?: RawArtifact
    client_mappings?: RawArtifact
    server_mappings?: RawArtifact
  }
  libraries?: RawLibrary[]
  arguments?: RawArguments
  minecraftArguments?: string
  logging?: {
    client?: {
      argument?: string
      type?: string
      file?: RawArtifact & { id?: string }
    }
  }
  javaVersion?: { majorVersion?: number; component?: string }
  minimumLauncherVersion?: number
  releaseTime?: string
  time?: string
  _comment_?: unknown
}

/** 需要在「子版本」中覆盖父版本的标量字段 */
const SCALAR_KEYS: (keyof RawVersion)[] = [
  'id',
  'type',
  'mainClass',
  'assets',
  'assetIndex',
  'downloads',
  'javaVersion',
  'logging',
  'minimumLauncherVersion',
  'releaseTime',
  'time',
]

export function readVersionJsonSync(file: string): RawVersion | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as RawVersion
  } catch {
    return null
  }
}

export async function readVersionJson(file: string): Promise<RawVersion | null> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as RawVersion
  } catch {
    return null
  }
}

/** 下载单个版本 JSON 文本（官方/镜像多源） */
export async function fetchVersionJsonText(
  url: string,
  mode: SourceMode,
  signal?: AbortSignal,
): Promise<string> {
  const result = await getTextFromSources(metaUrls(url, mode), { signal, timeoutMs: 60_000 })
  return result.data
}

/** 合并两份 JSON：base 为父版本，overlay 为子版本（PCL MergeJson 的单步版本） */
export function mergeVersionJson(base: RawVersion, overlay: RawVersion): RawVersion {
  const merged: RawVersion = { ...base }
  for (const key of SCALAR_KEYS) {
    const value = overlay[key]
    if (value !== undefined) {
      ;(merged as unknown as Record<string, unknown>)[key] = value
    }
  }
  if (overlay.jar !== undefined) merged.jar = overlay.jar
  // 数组按「父在前、子在后」拼接，与 Newtonsoft 默认的 MergeArrayHandling.Concat 一致
  const libraries = [...(base.libraries ?? []), ...(overlay.libraries ?? [])]
  if (libraries.length) merged.libraries = libraries
  const game = [...(base.arguments?.game ?? []), ...(overlay.arguments?.game ?? [])]
  const jvm = [...(base.arguments?.jvm ?? []), ...(overlay.arguments?.jvm ?? [])]
  if (game.length || jvm.length) merged.arguments = { game, jvm }
  const oldArgs = [base.minecraftArguments, overlay.minecraftArguments].filter(Boolean) as string[]
  if (oldArgs.length) merged.minecraftArguments = oldArgs.join(' ')
  return merged
}

/**
 * 依次合并若干 profile（第一个是原版，后面的按安装顺序叠加）。
 * 结果仍是「带 inheritsFrom 的草稿」，需要再调用 normalizeInstanceJson。
 */
export function mergeVersionProfiles(profiles: RawVersion[]): RawVersion {
  if (!profiles.length) throw new Error('没有可合并的版本 JSON')
  return profiles.slice(1).reduce((acc, item) => mergeVersionJson(acc, item), profiles[0])
}

/**
 * 生成最终写入磁盘的自包含版本 JSON：
 * 删除 inheritsFrom / jar / 注释，改写 id，与原版 JSON 的字段语义保持一致。
 * 对应 PCL 的 MergeJson 尾部处理。
 */
export function normalizeInstanceJson(json: RawVersion, instanceName: string): RawVersion {
  const normalized: RawVersion = { ...json, id: instanceName }
  delete normalized.inheritsFrom
  delete normalized.jar
  delete normalized._comment_
  if (normalized.minecraftArguments) {
    normalized.minecraftArguments = dedupeArguments(normalized.minecraftArguments)
  }
  return normalized
}

/** 拆分并去重旧版 minecraftArguments 里的参数（保持 -key value 成对） */
export function dedupeArguments(raw: string): string {
  const tokens = raw.split(' ').filter(Boolean)
  const pairs: string[] = []
  for (const token of tokens) {
    if (!token.startsWith('-') && pairs.length > 0 && pairs[pairs.length - 1].startsWith('-')) {
      pairs[pairs.length - 1] = `${pairs[pairs.length - 1]} ${token}`
    } else {
      pairs.push(token)
    }
  }
  return [...new Set(pairs)].join(' ')
}

/** 收集版本 JSON 里所有 game 参数（用于校验合并是否丢东西） */
export function flattenGameArguments(json: RawVersion): string[] {
  const result: string[] = []
  for (const item of json.arguments?.game ?? []) {
    if (typeof item === 'string') result.push(item)
    else if (item && typeof item === 'object') {
      const value = (item as { value?: unknown }).value
      if (typeof value === 'string') result.push(value)
      else if (Array.isArray(value)) result.push(...value.map(String))
    }
  }
  if (json.minecraftArguments) result.push(...json.minecraftArguments.split(' ').filter(Boolean))
  return result
}

/** 估算需要的 Java 版本（取所有 profile 中最大的 majorVersion） */
export function requiredJavaMajor(json: RawVersion): number | undefined {
  const major = json.javaVersion?.majorVersion
  return typeof major === 'number' ? major : undefined
}

/** 从版本目录中读取实例 JSON */
export async function readInstanceJson(
  root: string,
  instanceName: string,
): Promise<RawVersion | null> {
  return readVersionJson(path.join(root, 'versions', instanceName, `${instanceName}.json`))
}

/**
 * 安装器（Fabric/Quilt/Forge/NeoForge/LiteLoader/OptiFine）的统一接口。
 * 对应 PCL 的 `McInstallLoadersGet()` 里各个 LoaderTask 的职责划分：
 *   listXxxVersions  -> 版本下拉列表
 *   prepareXxx       -> 产出「待合并的版本 JSON + 额外文件」
 */
import type { SourceMode } from '../../shared/types'
import type { PlannedFile } from '../version'
import type { RawVersion } from '../version-json'

export type LoaderId = 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'liteloader' | 'optifine'

export interface LoaderVersionEntry {
  /** 安装时使用的版本号（写入 mcdl-install.json） */
  version: string
  label: string
  stable?: boolean
  recommended?: boolean
  releaseTime?: string
  /** 列表里携带的原始信息（OptiFine 的 filename/type/patch、LiteLoader 的 tweakClass 等） */
  meta?: Record<string, unknown>
}

export interface LoaderListResult {
  id: LoaderId
  label: string
  versions: LoaderVersionEntry[]
  source: string
  note?: string
  requiresJava?: boolean
}

export interface LoaderContext {
  root: string
  /** 最终实例目录名（用于 OptiFine 生成的版本名等） */
  instanceName: string
  mcVersion: string
  mode: SourceMode
  signal: AbortSignal
  tempDir: string
  log: (level: 'info' | 'warn' | 'error', text: string) => void
  /** 通过下载引擎下载一个文件（带重试、镜像回退、进度统计） */
  fetchFile: (urls: string[], dest: string, options?: { minSize?: number; label?: string }) => Promise<void>
  /** 运行 Java 安装器；找不到 Java 时抛出带说明的错误 */
  runInstaller: (
    javaArgs: string[],
    options?: { timeoutMs?: number; minJava?: number; env?: Record<string, string> },
  ) => Promise<void>
}

export interface LoaderResult {
  id: LoaderId
  version: string
  /** 待合并的 profile（通常带 inheritsFrom，会与原版 JSON 合并） */
  profile: RawVersion
  /** 由安装器额外产生、需要参与下载/校验的文件 */
  files?: PlannedFile[]
  warnings?: string[]
}

export interface LoaderListOptions {
  mcVersion: string
  mode: SourceMode
  signal?: AbortSignal
}

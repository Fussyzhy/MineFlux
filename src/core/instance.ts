/**
 * 实例（versions/<name>）的目录语义、安装清单、PCL 兼容标记。
 * 对应 PCL 的 `McInstance` / `PathIndie` / `.pclignore` / `McInstallManifest`。
 */
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import type { InstallComponents, InstalledInstance } from '../shared/types'
import { readJsonFile, writeJsonAtomic } from './fsutil'

export interface InstallManifest {
  schema: 1
  app: 'mineflux'
  instance: string
  mcVersion: string
  components: InstallComponents
  isolation: boolean
  installedAt: number
  fileCount: number
  totalBytes: number
  /** 安装是否完整（失败保留清单并标记 incomplete） */
  complete: boolean
}

export function instanceDir(root: string, name: string): string {
  return path.join(root, 'versions', name)
}

export function instanceJsonPath(root: string, name: string): string {
  return path.join(instanceDir(root, name), `${name}.json`)
}

export function instanceJarPath(root: string, name: string): string {
  return path.join(instanceDir(root, name), `${name}.jar`)
}

const MANIFEST_FILE = 'mineflux-install.json'

export function manifestPath(root: string, name: string): string {
  return path.join(instanceDir(root, name), MANIFEST_FILE)
}

/** 删除实例（只删 versions/<name>；根目录共享的 mods 等不动） */
export async function removeInstance(root: string, name: string): Promise<void> {
  const dir = instanceDir(root, name)
  const versionsDir = path.join(root, 'versions') + path.sep
  if (!path.resolve(dir).startsWith(path.resolve(versionsDir))) {
    throw new Error('实例路径异常，已取消删除')
  }
  await fsp.rm(dir, { recursive: true, force: true })
}

/** 版本隔离开启时，mods 等游戏数据跟着实例走；否则放游戏根目录（PCL 的 PathIndie） */
export function dataDirOf(root: string, name: string, isolation: boolean): string {
  return isolation ? instanceDir(root, name) : root
}

export function modsDirOf(root: string, name: string, isolation: boolean): string {
  return path.join(dataDirOf(root, name, isolation), 'mods')
}

/** PCL 用 .pclignore 标记「安装中的实例」，避免被识别为可用实例 */
export function pclIgnorePath(root: string, name: string): string {
  return path.join(instanceDir(root, name), '.pclignore')
}

export async function markInstalling(root: string, name: string): Promise<void> {
  await fsp.mkdir(instanceDir(root, name), { recursive: true })
  await fsp.writeFile(pclIgnorePath(root, name), '')
}

export async function unmarkInstalling(root: string, name: string): Promise<void> {
  await fsp.rm(pclIgnorePath(root, name), { force: true })
}

export async function isInstalling(root: string, name: string): Promise<boolean> {
  const file = pclIgnorePath(root, name)
  try {
    const stat = await fsp.stat(file)
    // 超过 2 小时的标记视为崩溃残留，直接清理
    if (Date.now() - stat.mtimeMs > 2 * 60 * 60 * 1000) {
      await fsp.rm(file, { force: true })
      return false
    }
    return true
  } catch {
    return false
  }
}

export async function readManifest(root: string, name: string): Promise<InstallManifest | null> {
  return readJsonFile<InstallManifest>(manifestPath(root, name))
}

export async function writeManifest(root: string, name: string, manifest: InstallManifest): Promise<void> {
  await writeJsonAtomic(manifestPath(root, name), manifest)
}

/** 按 PCL 的 ValidateFolderName 规则清洗实例名 */
export function sanitizeInstanceName(name: string): string {
  let value = (name ?? '').trim()
  value = value.replace(/[\\/:*?"<>|]/g, '_')
  value = value.replace(/[\u0000-\u001f]/g, '')
  value = value.replace(/[. ]+$/g, '')
  if (!value) value = 'Minecraft'
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(value)) value = `_${value}`
  return value.slice(0, 80)
}

export function isValidInstanceName(name: string): boolean {
  return sanitizeInstanceName(name) === name && name.length > 0
}

/** 新实例创建前检查是否与已有实例冲突 */
export async function instanceExists(root: string, name: string): Promise<boolean> {
  return fs.existsSync(instanceJsonPath(root, name))
}

/** 创建实例内需要的基础目录（PCL 只建 mods / resourcepacks） */
export async function ensureDataDirs(base: string): Promise<void> {
  for (const dir of ['mods', 'resourcepacks', 'shaderpacks']) {
    await fsp.mkdir(path.join(base, dir), { recursive: true })
  }
}

/** 原版版本 JSON 的主类；加载器实例会换成 KnotClient / BootstrapLauncher 等，据此区分基座与实例 */
const VANILLA_MAIN_CLASSES = new Set(['net.minecraft.client.main.Main', 'net.minecraft.client.Minecraft'])

/**
 * 原版基座：旧版本安装加载器时在 versions/ 里留下的原版版本目录（例如 versions/26.3）。
 * 特征是没有安装清单、没有 inheritsFrom、主类仍是原版主类。
 *
 * 现在的安装流程已经把原版 json / jar 放进临时工作区，安装完不再产生这种目录；
 * 这里保留判断是为了兼容旧版本安装留下的数据，避免它们被标成「外部实例」。
 */
function looksLikeVanillaBase(json: { inheritsFrom?: string; mainClass?: string }): boolean {
  if (json.inheritsFrom) return false
  return Boolean(json.mainClass && VANILLA_MAIN_CLASSES.has(json.mainClass))
}

/** 列出所有实例：优先用 mineflux-install.json，否则靠版本 JSON 推断 */
export async function listInstances(root: string): Promise<InstalledInstance[]> {
  const versionsDir = path.join(root, 'versions')
  let entries: fs.Dirent[] = []
  try {
    entries = await fsp.readdir(versionsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const result: InstalledInstance[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    const dir = instanceDir(root, name)
    const json = await readJsonFile<{
      id?: string
      inheritsFrom?: string
      type?: string
      mainClass?: string
    }>(instanceJsonPath(root, name))
    if (!json) continue
    if (await isInstalling(root, name)) {
      result.push({
        name,
        path: dir,
        components: {},
        managed: false,
        mcVersion: json.inheritsFrom ?? json.id,
        installing: true,
      })
      continue
    }
    const manifest = await readManifest(root, name)
    if (manifest) {
      result.push({
        name,
        path: dir,
        mcVersion: manifest.mcVersion,
        components: manifest.components ?? {},
        installedAt: manifest.installedAt,
        managed: true,
        isolation: manifest.isolation,
        complete: manifest.complete,
        fileCount: manifest.fileCount,
        totalBytes: manifest.totalBytes,
      })
    } else {
      result.push({
        name,
        path: dir,
        mcVersion: json.inheritsFrom ?? json.id,
        components: {},
        managed: false,
        base: looksLikeVanillaBase(json),
      })
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

/** 人类可读的组件摘要，例如 "1.20.1 · Fabric 0.15.11 · OptiFine G5" */
export function describeComponents(components: InstallComponents): string {
  const parts: string[] = []
  if (components.fabric) parts.push(`Fabric ${components.fabric}`)
  if (components.quilt) parts.push(`Quilt ${components.quilt}`)
  if (components.forge) parts.push(`Forge ${components.forge}`)
  if (components.neoforge) parts.push(`NeoForge ${components.neoforge}`)
  if (components.liteloader) parts.push(`LiteLoader ${components.liteloader}`)
  if (components.optifine) parts.push(`OptiFine ${components.optifine}`)
  if (components.fabricApi) parts.push('Fabric API')
  if (components.optifabric) parts.push('OptiFabric')
  return parts.join(' · ')
}

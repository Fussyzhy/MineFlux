/**
 * OptiFine 加载器。
 * 对应 PCL 的 `McDownloadOptiFineLoader()`：
 *  - 1.14+（方式 A）：运行 OptiFine 自带安装器（需要 Java），把生成的文件合并进游戏目录；
 *  - 1.13.2 及更早（方式 B）：不需要 Java，把 OptiFine jar 放进 libraries，构造一个 tweakClass 版本 JSON。
 * 另外支持「作为 Mod 安装」（Fabric/Quilt + OptiFine 时需要配合 OptiFabric）。
 */
import path from 'node:path'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import { getJsonFromSources, getTextFromSources } from '../http'
import { sha1File } from '../downloader'
import { readVersionJson, type RawVersion } from '../version-json'
import { copyDirMerge, ensureDir, versionDrop } from '../fsutil'
import { OPTIFINE_DOWNLOAD_MIRROR, OPTIFINE_LIST_MIRROR } from './sources'
import type { LoaderContext, LoaderListOptions, LoaderListResult, LoaderResult, LoaderVersionEntry } from './types'
import { loaderWorkRoot } from './types'

interface OptiFineListEntry {
  mcversion?: string
  type?: string
  patch?: string
  filename?: string
  forge?: string
}

export interface OptiFineEntry {
  mcVersion: string
  type: string
  patch: string
  filename: string
}

function displayName(entry: OptiFineListEntry): string {
  const type = (entry.type ?? 'HD_U').replace('HD_U', 'HD U').replace(/_/g, ' ')
  return `${type} ${entry.patch ?? ''}`.trim()
}

export async function listOptiFine(options: LoaderListOptions): Promise<LoaderListResult> {
  const { data } = await getJsonFromSources<OptiFineListEntry[]>([OPTIFINE_LIST_MIRROR], {
    signal: options.signal,
    timeoutMs: 30_000,
  })
  const versions: LoaderVersionEntry[] = data
    .filter((entry) => entry.mcversion === options.mcVersion && entry.patch && entry.type)
    .map((entry) => ({
      version: `${entry.type}_${entry.patch}`,
      label: displayName(entry),
      stable: !(entry.patch ?? '').toLowerCase().includes('pre'),
      releaseTime: undefined,
    }))
    .filter((entry) => entry.version)
  if (versions[0]) versions[0].recommended = true
  return {
    id: 'optifine',
    label: 'OptiFine',
    versions,
    source: 'BMCLAPI / optifine.net',
    note: versions.length ? undefined : '该 Minecraft 版本没有可用的 OptiFine',
  }
}

/** 版本字符串（type_patch）拆成 type / patch */
export function splitOptiFineVersion(version: string): { type: string; patch: string } {
  const value = version
    .replace(/^OptiFine_/i, '')
    .replace(/\.jar$/i, '')
    // 兼容 1.12.2_HD_U_G5 这种带 MC 前缀的写法
    .replace(/^\d+(?:\.\d+)*_/, '')
  // type 本身可能含下划线（HD_U），patch 一定以「大写字母 + 数字」开头（G5 / G5_pre1）
  const match = /^(.*?)_([A-Z]+\d.*)$/.exec(value)
  if (match) return { type: match[1], patch: match[2] }
  const index = value.lastIndexOf('_')
  if (index <= 0) return { type: value, patch: '' }
  return { type: value.slice(0, index), patch: value.slice(index + 1) }
}

/** 拼出 OptiFine jar 的下载地址（BMCLAPI 优先，官方 adloadx 兜底） */
export async function optiFineUrls(
  mcVersion: string,
  version: string,
  mode: 'auto' | 'official' | 'mirror',
  signal?: AbortSignal,
): Promise<string[]> {
  const { type, patch } = splitOptiFineVersion(version)
  const bmclapiMc = mcVersion === '1.8' || mcVersion === '1.9' ? `${mcVersion}.0` : mcVersion
  const filename = `OptiFine_${mcVersion}_${type}_${patch}.jar`
  const mirrorUrls = [
    `${OPTIFINE_DOWNLOAD_MIRROR}/${bmclapiMc}/${type}/${patch}`,
    `${OPTIFINE_DOWNLOAD_MIRROR}/${bmclapiMc}/${type}_${patch}`,
  ]
  const urls = mode === 'official' || mode === 'mirror' ? [] : mirrorUrls
  try {
    const page = await getTextFromSources([`https://optifine.net/adloadx?f=${filename}`], {
      signal,
      timeoutMs: 20_000,
      headers: { Accept: 'text/html' },
    })
    const match = /downloadx\?f=[^"']+/.exec(page.data)
    if (match) urls.push(`https://optifine.net/${match[0]}`)
  } catch {
    // 官方页面拿不到就只用 BMCLAPI
  }
  if (mode === 'mirror') return mirrorUrls
  // 官方地址拿得到就优先官方，镜像永远兜底（官方 downloadx 经常返回很小的占位页）
  return urls.length ? [...urls, ...mirrorUrls] : mirrorUrls
}

/** 把 OptiFine jar 下载到临时目录，返回路径（作为 Mod 安装时也用它） */
export async function downloadOptiFineJar(
  version: string,
  ctx: LoaderContext,
): Promise<{ jarPath: string; filename: string; mcVersion: string }> {
  const { type, patch } = splitOptiFineVersion(version)
  const filename = `OptiFine_${ctx.mcVersion}_${type}_${patch}.jar`
  const jarPath = path.join(ctx.tempDir, filename)
  await ctx.fetchFile(await optiFineUrls(ctx.mcVersion, version, ctx.mode, ctx.signal), jarPath, {
    minSize: 200 * 1024,
    label: 'OptiFine',
  })
  return { jarPath, filename, mcVersion: ctx.mcVersion }
}

/** 作为 Mod 安装：直接放进 mods/ 目录 */
export async function installOptiFineAsMod(
  version: string,
  ctx: LoaderContext,
  modsDir: string,
): Promise<string> {
  const { jarPath, filename } = await downloadOptiFineJar(version, ctx)
  await ensureDir(modsDir)
  const dest = path.join(modsDir, filename)
  await fsp.copyFile(jarPath, dest)
  ctx.log('info', `OptiFine 已作为 Mod 安装：${filename}（需要 OptiFabric 才能在 Fabric 下生效）`)
  return dest
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    return (await fsp.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** 方式 A：运行 OptiFine 安装器 */
async function installViaInstaller(ctx: LoaderContext, jarPath: string): Promise<RawVersion> {
  const home = path.join(ctx.tempDir, `optifine-home`)
  const mcDir = path.join(home, '.minecraft')
  const vanillaFolder = path.join(mcDir, 'versions', ctx.mcVersion)
  await ensureDir(vanillaFolder)
  // 原版 json / jar 在安装工作区里（PCL 的 TempMcFolder），没有时再回退真实目录
  const searchRoots = ctx.workRoot ? [loaderWorkRoot(ctx), ctx.root] : [ctx.root]
  for (const name of [`${ctx.mcVersion}.json`, `${ctx.mcVersion}.jar`]) {
    for (const searchRoot of searchRoots) {
      const from = path.join(searchRoot, 'versions', ctx.mcVersion, name)
      if (fs.existsSync(from)) {
        await fsp.copyFile(from, path.join(vanillaFolder, name))
        break
      }
    }
  }
  if (!fs.existsSync(path.join(vanillaFolder, `${ctx.mcVersion}.jar`))) {
    throw new Error('安装 OptiFine 需要先下载原版客户端 jar')
  }
  await fsp.writeFile(
    path.join(mcDir, 'launcher_profiles.json'),
    JSON.stringify({ profiles: {}, settings: {}, version: 3 }),
    'utf8',
  )
  const before = await listDirs(path.join(mcDir, 'versions'))
  ctx.log('info', '开始运行 OptiFine 安装器')
  await ctx.runInstaller(
    [`-Duser.home=${home}`, '-cp', jarPath, 'optifine.Installer'],
    { minJava: 8, timeoutMs: 10 * 60 * 1000, env: { APPDATA: home } },
  )
  const added = (await listDirs(path.join(mcDir, 'versions'))).filter(
    (name) => !before.includes(name) && name !== ctx.mcVersion,
  )
  const folder = added.find((name) =>
    fs.existsSync(path.join(mcDir, 'versions', name, `${name}.json`)),
  )
  if (!folder) throw new Error('OptiFine 安装器没有生成版本 JSON')
  const profile = await readVersionJson(path.join(mcDir, 'versions', folder, `${folder}.json`))
  if (!profile) throw new Error('OptiFine 安装器生成的版本 JSON 无法解析')
  // 安装器产出的 libraries 合并进真实目录（多实例共享）；versions/ 里的中间产物不落到游戏目录
  const copied = await copyDirMerge(mcDir, ctx.root, new Set(['launcher_profiles.json', 'versions']))
  ctx.log('info', `OptiFine 安装器生成了 ${copied} 个文件，已合并进游戏目录`)
  await fsp.rm(home, { recursive: true, force: true })
  return profile
}

export async function prepareOptiFine(version: string, ctx: LoaderContext): Promise<LoaderResult> {
  const { jarPath } = await downloadOptiFineJar(version, ctx)
  // PCL 的判断：1.14 及更新（含快照）必须运行安装器；1.13.2 及更旧可以直接构造 JSON
  const drop = versionDrop(ctx.mcVersion)
  if (drop >= 1140 || ctx.mcVersion.includes('w')) {
    const profile = await installViaInstaller(ctx, jarPath)
    return { id: 'optifine', version, profile }
  }

  // 方式 B：不需要 Java
  const { type, patch } = splitOptiFineVersion(version)
  const filename = `OptiFine_${ctx.mcVersion}_${type}_${patch}.jar`
  const libraryVersion = filename.replace(/^OptiFine_/, '').replace(/\.jar$/, '')
  const relativePath = `optifine/OptiFine/${libraryVersion}/OptiFine-${libraryVersion}.jar`
  const dest = path.join(ctx.root, 'libraries', relativePath.split('/').join(path.sep))
  await ensureDir(path.dirname(dest))
  await fsp.copyFile(jarPath, dest)
  const sha1 = await sha1File(dest)
  const size = (await fsp.stat(dest)).size
  const instanceName = `${ctx.mcVersion}-OptiFine_${type}_${patch}`
  const profile: RawVersion = {
    id: instanceName,
    inheritsFrom: ctx.mcVersion,
    type: 'release',
    mainClass: 'net.minecraft.launchwrapper.Launch',
    arguments: { game: ['--tweakClass', 'optifine.OptiFineTweaker'] },
    libraries: [
      {
        name: `optifine:OptiFine:${libraryVersion}`,
        downloads: {
          artifact: { path: relativePath, sha1, size, url: '' },
        },
      },
      { name: 'net.minecraft:launchwrapper:1.12' },
    ],
    minimumLauncherVersion: 18,
  }
  ctx.log('info', `OptiFine ${version} 以方式 B 安装（无需 Java）：${relativePath}`)
  return { id: 'optifine', version, profile }
}


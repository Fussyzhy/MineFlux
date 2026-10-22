/**
 * 文件系统小工具：原子写、目录合并复制、版本号比较等。
 */
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'

export async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true })
}

export async function writeFileAtomic(file: string, content: string | Buffer): Promise<void> {
  await ensureDir(path.dirname(file))
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  await fsp.writeFile(temp, content)
  await fsp.rm(file, { force: true })
  await fsp.rename(temp, file)
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(value, null, 2))
}

/**
 * 把一个「相对路径」安全地拼到基准目录下，拒绝绝对路径、盘符与 `..` 越界。
 * 整合包清单与版本 JSON 里的路径都来自外部文件，必须经过这里才能落盘。
 */
export function safeJoin(baseDir: string, relative: string): string {
  const base = path.resolve(baseDir)
  const rel = String(relative ?? '').replace(/\\/g, '/').trim()
  if (!rel) throw new Error('路径为空')
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.startsWith('//')) {
    throw new Error(`不允许绝对路径：${relative}`)
  }
  const target = path.resolve(base, rel)
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`路径越界（必须位于 ${base} 内）：${relative}`)
  }
  return target
}

export async function readJsonFile<T = unknown>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

/** 递归复制目录并合并到目标（同名文件覆盖） */
export async function copyDirMerge(source: string, target: string, skip: Set<string> = new Set()): Promise<number> {
  let count = 0
  let entries: fs.Dirent[] = []
  try {
    entries = await fsp.readdir(source, { withFileTypes: true })
  } catch {
    return 0
  }
  await ensureDir(target)
  for (const entry of entries) {
    if (skip.has(entry.name)) continue
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) {
      count += await copyDirMerge(from, to, skip)
    } else if (entry.isFile()) {
      await ensureDir(path.dirname(to))
      await fsp.copyFile(from, to).catch(async () => {
        await fsp.rm(to, { force: true })
        await fsp.copyFile(from, to)
      })
      count++
    }
  }
  return count
}

/** 解析 "1.14.4" 这样的版本号为数值，用于阈值判断 */
export function versionDrop(version: string): number {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version)
  if (!match) return 0
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3] ?? 0)
  if (major === 1) return 1000 + minor * 10 + Math.min(patch, 9)
  return major * 10 + minor
}

export function isAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError' || error.message.includes('已取消'))
  )
}

/**
 * Java 运行时探测与调用。
 * Forge / NeoForge / OptiFine 的官方安装器需要 Java，这里负责找到可用的 JVM。
 * 对应 PCL 的 `ModLaunch` Java 自动选择逻辑（简化版）。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface JavaInfo {
  path: string
  major: number
  version: string
  source: string
}

let cache: JavaInfo[] | null = null

function exeName(): string {
  return process.platform === 'win32' ? 'java.exe' : 'java'
}

function candidatePaths(): { file: string; source: string }[] {
  const result: { file: string; source: string }[] = []
  const push = (dir: string | undefined, source: string): void => {
    if (!dir) return
    result.push({ file: path.join(dir, 'bin', exeName()), source })
  }

  push(process.env.MINEFLUX_JAVA_HOME, 'MINEFLUX_JAVA_HOME')
  push(process.env.JAVA_HOME, 'JAVA_HOME')

  // PATH
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir.trim()) result.push({ file: path.join(dir.trim(), exeName()), source: 'PATH' })
  }

  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramW6432,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : undefined,
  ].filter(Boolean) as string[]

  const vendors = [
    'Java',
    'Eclipse Adoptium',
    'Eclipse Foundation',
    'AdoptOpenJDK',
    'Microsoft',
    'Zulu',
    'BellSoft',
    'Amazon Corretto',
    'Semeru',
    'Temurin',
  ]
  for (const root of roots) {
    for (const vendor of vendors) {
      const base = path.join(root, vendor)
      let entries: string[] = []
      try {
        entries = fs.readdirSync(base)
      } catch {
        continue
      }
      for (const entry of entries) {
        push(path.join(base, entry), `${vendor}/${entry}`)
      }
    }
  }

  // 启动器自带的运行时（官方启动器 / 常见第三方启动器目录）
  const userHome = process.env.USERPROFILE ?? process.env.HOME
  if (userHome) {
    const runtimes = [
      path.join(userHome, 'AppData', 'Local', 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe'),
    ]
    for (const runtime of runtimes) scanRuntime(runtime, result)
  }
  return result
}

function scanRuntime(root: string, out: { file: string; source: string }[], depth = 0): void {
  if (depth > 4) return
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isFile() && entry.name === exeName()) out.push({ file: full, source: '启动器自带' })
    else if (entry.isDirectory()) scanRuntime(full, out, depth + 1)
  }
}

/** 执行 `java -version` 解析版本号，失败返回 null */
export async function probeJava(file: string, source: string): Promise<JavaInfo | null> {
  if (!fs.existsSync(file)) return null
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(file, ['-version'], { windowsHide: true })
      let text = ''
      child.stdout.on('data', (chunk) => (text += String(chunk)))
      child.stderr.on('data', (chunk) => (text += String(chunk)))
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve(text) : reject(new Error(`exit ${code}`))))
      setTimeout(() => {
        child.kill()
        reject(new Error('timeout'))
      }, 5000)
    })
    const version = /version "([^"]+)"/.exec(output)?.[1] ?? ''
    const major = parseMajor(version)
    if (!major) return null
    return { path: file, major, version, source }
  } catch {
    return null
  }
}

export function parseMajor(version: string): number {
  if (!version) return 0
  if (version.startsWith('1.')) return Number(version.split('.')[1]) || 0
  return Number(version.split('.')[0]) || 0
}

/** 扫描本机所有可用 Java（结果会缓存） */
export async function detectJava(): Promise<JavaInfo[]> {
  if (cache) return cache
  const seen = new Set<string>()
  const found: JavaInfo[] = []
  for (const candidate of candidatePaths()) {
    const key = candidate.file.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const info = await probeJava(candidate.file, candidate.source)
    if (info) found.push(info)
  }
  cache = found.sort((a, b) => a.major - b.major || b.version.localeCompare(a.version))
  return cache
}

/** 按需选择 Java：优先选择满足最低大版本的最小版本，否则退回最大的 */
export async function pickJava(minMajor?: number): Promise<JavaInfo | null> {
  const all = await detectJava()
  if (!all.length) return null
  if (!minMajor) return all[all.length - 1]
  const enough = all.filter((item) => item.major >= minMajor)
  return enough.length ? enough[0] : all[all.length - 1]
}

export interface RunJavaOptions {
  args: string[]
  cwd: string
  onLine?: (line: string) => void
  timeoutMs?: number
  env?: Record<string, string>
}

/** 运行一个 Java 进程（用于官方安装器），返回退出码与捕获的输出 */
export async function runJava(
  javaPath: string,
  options: RunJavaOptions,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(javaPath, options.args, {
      cwd: options.cwd,
      windowsHide: true,
      env: { ...process.env, ...options.env },
    })
    let output = ''
    const handle = (chunk: Buffer): void => {
      const text = String(chunk)
      output += text
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed) options.onLine?.(trimmed)
      }
    }
    child.stdout.on('data', handle)
    child.stderr.on('data', handle)
    child.on('error', reject)
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('安装器运行超时'))
    }, options.timeoutMs ?? 10 * 60 * 1000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, output })
    })
  })
}

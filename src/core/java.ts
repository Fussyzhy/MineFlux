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

/** 手动配置的 Java（设置页里指定，安装器会优先使用它） */
export interface ManualJavaSetting {
  /** 用户填写的路径：java.exe 本身、JAVA_HOME 目录或 bin 目录都可以 */
  path: string
  /** 是否优先于自动检测的结果 */
  prefer?: boolean
}

let cache: JavaInfo[] | null = null
/** 手动指定的 Java：由主进程在启动与保存设置时注入，自动检测的第一优先级 */
let manual: ManualJavaSetting | null = null
/** 手动 Java 解析后的可执行文件（解析失败为空串） */
let manualFile = ''

function exeName(): string {
  return process.platform === 'win32' ? 'java.exe' : 'java'
}

/** 文件路径的规范形式：Windows 用真实大小写 + 反斜杠，便于和探测结果比较 */
function normalizeFile(file: string): string {
  const resolved = path.resolve(file)
  try {
    return path.normalize(fs.realpathSync.native(resolved))
  } catch {
    return path.normalize(resolved)
  }
}

function sameFile(a: string, b: string): boolean {
  if (!a || !b) return false
  return normalizeFile(a).toLowerCase() === normalizeFile(b).toLowerCase()
}

/**
 * 把手动配置的路径解析成 java 可执行文件。
 * 支持三种写法：java.exe 本身、JDK/JRE 根目录（自动补 bin/java.exe）、bin 目录（自动补 java.exe）。
 */
export function resolveJavaExecutable(input: string): string {
  const trimmed = input.trim().replace(/^"(.*)"$/, '$1')
  if (!trimmed) return ''
  let stat: fs.Stats | null = null
  try {
    stat = fs.statSync(trimmed)
  } catch {
    return ''
  }
  if (stat.isFile()) return trimmed
  const direct = path.join(trimmed, exeName())
  if (fs.existsSync(direct)) return direct
  return path.join(trimmed, 'bin', exeName())
}

/** 注入 / 清除手动配置的 Java（主进程用）；设置变化时同时让检测缓存失效 */
export function setManualJava(setting: ManualJavaSetting | null): void {
  manual = setting && setting.path.trim() ? { path: setting.path, prefer: setting.prefer } : null
  manualFile = manual ? resolveJavaExecutable(manual.path) : ''
  cache = null
}

/** 手动配置的 Java 解析后的 java 可执行文件（路径无效时为空串） */
export function getManualJavaFile(): string {
  return manualFile
}

/** 某个探测结果是否就是手动配置的那个 java.exe */
export function isManualJava(file: string): boolean {
  return sameFile(file, manualFile)
}

export function getManualJava(): ManualJavaSetting | null {
  return manual
}

/** 是否配置了「始终优先使用手动 Java」 */
export function prefersManualJava(): boolean {
  return Boolean(manual?.prefer)
}

function candidatePaths(): { file: string; source: string }[] {
  const result: { file: string; source: string }[] = []
  const push = (dir: string | undefined, source: string): void => {
    if (!dir) return
    result.push({ file: path.join(dir, 'bin', exeName()), source })
  }

  // 手动配置的 Java 排在第一位：detectJava 的返回顺序即 pickJava 的选择顺序
  if (manualFile) result.push({ file: manualFile, source: '手动配置' })

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

function isManual(info: JavaInfo): boolean {
  return isManualJava(info.path)
}

function sortJava(list: JavaInfo[]): JavaInfo[] {
  return list.sort((a, b) => {
    // 手动配置的 Java 始终排在最前（界面与 pickJava 都按这个顺序理解）
    if (isManual(a) !== isManual(b)) return isManual(a) ? -1 : 1
    return a.major - b.major || b.version.localeCompare(a.version)
  })
}

/** 扫描本机所有可用 Java（结果会缓存；手动配置的 Java 排在最前） */
export async function detectJava(force?: boolean): Promise<JavaInfo[]> {
  if (cache && !force) return cache
  cache = null
  const found: JavaInfo[] = []
  // 同一份 java.exe 可能被多个来源找到（手动配置 vs PATH / 启动器），
  // 按规范化后的真实路径去重，并且只要路径就是手动配置的那个，来源统一标成「手动配置」
  const index = new Map<string, number>()
  for (const candidate of candidatePaths()) {
    const key = normalizeFile(candidate.file).toLowerCase()
    const manualSource = isManualJava(candidate.file)
    const existing = index.get(key)
    if (existing !== undefined) {
      if (manualSource) found[existing].source = '手动配置'
      continue
    }
    const info = await probeJava(candidate.file, candidate.source)
    if (info) {
      if (manualSource) info.source = '手动配置'
      index.set(key, found.length)
      found.push(info)
    }
  }
  cache = sortJava(found)
  return cache
}

/**
 * 按需选择 Java：
 *  - 配置了「优先使用手动 Java」且它满足最低大版本时，直接用它运行安装器；
 *  - 否则仍按「满足最低大版本的最小版本」挑选，手动 Java 只在同等条件下优先。
 */
export async function pickJava(minMajor?: number): Promise<JavaInfo | null> {
  const all = await detectJava()
  if (!all.length) return null
  // detectJava 已把手动 Java 排在第一位：开启「优先手动」且满足最低大版本时直接用它
  const manualInfo = all.find(isManual) ?? null
  if (manualInfo && prefersManualJava() && (!minMajor || manualInfo.major >= minMajor)) {
    return manualInfo
  }
  if (!minMajor) {
    const others = all.filter((item) => !isManual(item))
    return others.length ? others[others.length - 1] : all[all.length - 1]
  }
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

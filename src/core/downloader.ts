import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { FileFailure } from '../shared/types'
import { errorText, fetchOnce } from './http'
import type { PlannedFile } from './version'

const RETRY_PER_SOURCE = 2
const RETRY_DELAY_MS = 350
/** 超过这个体积的文件才会尝试分片并发（对应 PCL 的 FilePieceLimit 思路） */
const SPLIT_THRESHOLD = 8 * 1024 * 1024
const SPLIT_PART_SIZE = 6 * 1024 * 1024
const SPLIT_MAX_PARTS = 6
const REQUEST_TIMEOUT_MS = 90_000

export interface EngineCallbacks {
  log: (level: 'info' | 'warn' | 'error' | 'debug', text: string) => void
  onFileStart: (file: PlannedFile) => void
  onBytes: (file: PlannedFile, delta: number) => void
  onFileDone: (file: PlannedFile) => void
  onFileSkip: (file: PlannedFile) => void
  onFileFail: (file: PlannedFile, error: string) => void
}

export interface EngineOptions extends EngineCallbacks {
  concurrency: number
  verifyHashes: boolean
}

export interface RunResult {
  skipped: string[]
  failed: FileFailure[]
  remaining: PlannedFile[]
  aborted: boolean
}

class RangeUnsupportedError extends Error {
  constructor() {
    super('服务器不支持 Range 请求')
    this.name = 'RangeUnsupportedError'
  }
}

class HashMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`SHA1 校验失败（期望 ${expected}，实际 ${actual}）`)
    this.name = 'HashMismatchError'
  }
}

export async function sha1File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha1')
  const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })
  for await (const chunk of stream) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function fileMatches(
  file: PlannedFile,
  verifyHashes: boolean,
): Promise<boolean> {
  try {
    const stat = await fsp.stat(file.dest)
    if (!stat.isFile()) return false
    if (file.size >= 0 && stat.size !== file.size) return false
    if (!file.sha1) {
      if (file.size >= 0) return true // 大小已知且已在上一条里精确吻合
      // 既无 SHA1 又无大小声明的文件无法证明完整性：校验模式下按「缺失」处理，
      // 强制重下；只有用户明确关闭哈希校验时才退化为「非空即存在」
      return verifyHashes ? false : stat.size > 0
    }
    if (!verifyHashes) return true
    return (await sha1File(file.dest)) === file.sha1
  } catch {
    return false
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export class DownloadEngine {
  private controller = new AbortController()

  constructor(private readonly options: EngineOptions) {}

  /** 暂停/取消当前所有请求；run() 会尽快返回 */
  abort(): void {
    this.controller.abort()
  }

  isAborted(): boolean {
    return this.controller.signal.aborted
  }

  // ------------------------------------------------------------ 下载源健康度

  private hostHealth = new Map<string, { fails: number; blockedUntil: number }>()

  /** 过滤掉被熔断的下载源；若全部被熔断则退回完整列表，避免无源可用 */
  private usableUrls(urls: string[]): string[] {
    const now = Date.now()
    const usable = urls.filter((url) => {
      const health = this.hostHealth.get(hostOf(url))
      return !health || health.blockedUntil <= now
    })
    return usable.length ? usable : urls
  }

  private markHostSuccess(url: string): void {
    this.hostHealth.delete(hostOf(url))
  }

  private markHostFailure(url: string): void {
    const host = hostOf(url)
    const health = this.hostHealth.get(host) ?? { fails: 0, blockedUntil: 0 }
    health.fails++
    if (health.fails >= 3 && health.blockedUntil <= Date.now()) {
      health.blockedUntil = Date.now() + 60_000
      this.options.log('warn', `下载源 ${host} 连续失败，60 秒内优先使用其它源`)
    }
    this.hostHealth.set(host, health)
  }

  /** 清理未完成的临时文件（取消时调用） */
  static async cleanupParts(files: PlannedFile[]): Promise<void> {
    await Promise.all(
      files.map(async (file) => {
        await fsp.rm(`${file.dest}.part`, { force: true }).catch(() => undefined)
      }),
    )
  }

  async run(files: PlannedFile[]): Promise<RunResult> {
    this.controller = new AbortController()
    const signal = this.controller.signal
    const queue = [...files]
    const result: RunResult = { skipped: [], failed: [], remaining: [], aborted: false }
    const workerCount = Math.max(1, Math.min(this.options.concurrency, queue.length || 1))

    const worker = async (): Promise<void> => {
      for (;;) {
        if (signal.aborted) return
        const file = queue.shift()
        if (!file) return
        if (signal.aborted) {
          queue.unshift(file)
          return
        }
        try {
          const matched = await fileMatches(file, this.options.verifyHashes)
          if (matched) {
            result.skipped.push(file.dest)
            this.options.onFileSkip(file)
            continue
          }
          this.options.onFileStart(file)
          await this.downloadFile(file, signal)
          await this.finishFile(file)
          this.options.onFileDone(file)
        } catch (error) {
          // 只有用户信号真正 abort 才算取消。请求超时（TimeoutError）必须走正常的
          // 失败/重试/换源路径——否则文件被塞回队列、worker 提前退出，剩余文件被上层静默丢弃
          if (signal.aborted) {
            queue.unshift(file)
            return
          }
          const message = errorText(error)
          result.failed.push({ path: file.dest, kind: file.kind, error: message, urls: file.urls })
          this.options.onFileFail(file, message)
        }
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    result.remaining = queue
    result.aborted = signal.aborted
    return result
  }

  // ---------------------------------------------------------------- 单文件流程

  private async downloadFile(file: PlannedFile, signal: AbortSignal): Promise<void> {
    if (file.urls.length === 0) throw new Error('没有可用的下载地址')
    const tmp = `${file.dest}.part`
    const errors: string[] = []
    const candidates = this.usableUrls(file.urls)

    for (const url of candidates) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      for (let attempt = 1; attempt <= RETRY_PER_SOURCE; attempt++) {
        try {
          await fsp.mkdir(path.dirname(file.dest), { recursive: true })
          if (file.size >= SPLIT_THRESHOLD && file.urls.length > 0) {
            await this.downloadSplit(file, url, tmp, signal)
          } else {
            await this.downloadSingle(file, url, tmp, signal)
          }
          await this.verifyTmp(file, tmp)
          this.markHostSuccess(url)
          return
        } catch (error) {
          // 同 worker：只有用户中止才向上抛终止信号；超时错误交给下面的重试/换源逻辑
          if (signal.aborted) throw error
          this.markHostFailure(url)
          if (error instanceof RangeUnsupportedError) {
            await fsp.rm(tmp, { force: true })
            await this.downloadSingle(file, url, tmp, signal)
            await this.verifyTmp(file, tmp)
            return
          }
          if (error instanceof HashMismatchError) {
            // 内容损坏：丢弃临时文件，立刻换下一个源
            await fsp.rm(tmp, { force: true })
            errors.push(`${hostOf(url)}: ${error.message}`)
            this.options.log('warn', `${file.dest} 校验失败，切换下载源`)
            break
          }
          errors.push(`${hostOf(url)}: ${errorText(error)}`)
          if (attempt < RETRY_PER_SOURCE) {
            this.options.log('debug', `重试 ${file.dest}（第 ${attempt} 次失败：${errorText(error)}）`)
            await sleep(RETRY_DELAY_MS * attempt, signal)
          }
        }
      }
    }
    throw new Error(errors.join(' ; ') || '下载失败')
  }

  /** 单流下载（带断点续传：存在 .part 时用 Range 续传） */
  private async downloadSingle(
    file: PlannedFile,
    url: string,
    tmp: string,
    signal: AbortSignal,
  ): Promise<void> {
    let start = 0
    try {
      const stat = await fsp.stat(tmp)
      if (stat.isFile() && stat.size > 0) {
        if (file.size < 0 || stat.size < file.size) start = stat.size
        else {
          // 已有大小 >= 期望大小，交给校验环节判断
          return
        }
      }
    } catch {
      start = 0
    }

    const headers: Record<string, string> = {}
    if (start > 0) headers.Range = `bytes=${start}-`
    const res = await fetchOnce(url, { signal, timeoutMs: REQUEST_TIMEOUT_MS, headers })

    let offset = start
    if (start > 0 && res.status === 200) {
      // 服务器忽略 Range，只能从头来
      offset = 0
      start = 0
    }
    if (!res.body) throw new Error('响应没有内容')

    const handle = await fsp.open(tmp, start > 0 ? 'a' : 'w')
    try {
      for await (const chunk of Readable.fromWeb(res.body as never)) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const buffer = chunk as Buffer
        await handle.write(buffer)
        offset += buffer.length
        if (file.size >= 0 && offset > file.size) {
          throw new Error('实际大小超过预期，文件可能来自错误的源')
        }
        this.options.onBytes(file, buffer.length)
      }
      // 无 SHA1 / 大小声明时的兜底校验：写入长度必须与 Content-Length 吻合，
      // 防止镜像返回的截断响应被当成「下载成功」
      if (file.size < 0 && !file.sha1) {
        const contentLength = Number(res.headers?.get('content-length'))
        if (Number.isFinite(contentLength) && contentLength > 0 && offset !== start + contentLength) {
          throw new Error(
            `下载长度与 Content-Length 不符（${offset}/${start + contentLength}），文件可能被截断`,
          )
        }
      }
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  /** 分片并发下载（对应 PCL 的多线程分片逻辑） */
  private async downloadSplit(
    file: PlannedFile,
    url: string,
    tmp: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (file.size < SPLIT_THRESHOLD) return this.downloadSingle(file, url, tmp, signal)
    const parts = Math.min(SPLIT_MAX_PARTS, Math.max(2, Math.ceil(file.size / SPLIT_PART_SIZE)))
    const size = file.size
    const ranges = Array.from({ length: parts }, (_, index) => {
      const start = Math.floor((size / parts) * index)
      const end = index === parts - 1 ? size - 1 : Math.floor((size / parts) * (index + 1)) - 1
      return { start, end }
    })

    const handle = await fsp.open(tmp, 'w')
    try {
      await Promise.all(
        ranges.map(async (range, index) => {
          const expected = range.end - range.start + 1
          let written = 0
          const res = await fetchOnce(url, {
            signal,
            timeoutMs: REQUEST_TIMEOUT_MS,
            headers: { Range: `bytes=${range.start}-${range.end}` },
          })
          if (res.status !== 206) throw new RangeUnsupportedError()
          if (!res.body) throw new Error('响应没有内容')
          let position = range.start
          for await (const chunk of Readable.fromWeb(res.body as never)) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
            const buffer = chunk as Buffer
            await handle.write(buffer, 0, buffer.length, position)
            position += buffer.length
            written += buffer.length
            if (written > expected) throw new Error('分片长度超出范围')
            this.options.onBytes(file, buffer.length)
          }
          if (written !== expected) {
            throw new Error(`分片 ${index} 长度不足（${written}/${expected}）`)
          }
        }),
      )
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  private async verifyTmp(file: PlannedFile, tmp: string): Promise<void> {
    const stat = await fsp.stat(tmp)
    if (file.size >= 0 && stat.size !== file.size) {
      await fsp.rm(tmp, { force: true })
      throw new Error(`文件大小不符（${stat.size}/${file.size}）`)
    }
    if (file.sha1) {
      const actual = await sha1File(tmp)
      if (actual !== file.sha1) {
        throw new HashMismatchError(file.sha1, actual)
      }
    }
  }

  private async finishFile(file: PlannedFile): Promise<void> {
    const tmp = `${file.dest}.part`
    await fsp.mkdir(path.dirname(file.dest), { recursive: true })
    await fsp.rename(tmp, file.dest)
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * 极简 HTTP 层：多源顺序尝试 + 超时 + 统一 UA。
 * 多源顺序的语义对应 PCL 的 DlSourceOrder / DlSourceLoader。
 */

export const USER_AGENT = 'mcdownload/0.1 (+https://github.com/) third-party-downloader'

export interface RequestInitEx {
  signal?: AbortSignal
  timeoutMs?: number
  headers?: Record<string, string>
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function joinSignals(outer: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return outer ? AbortSignal.any([outer, timeout]) : timeout
}

export async function fetchOnce(url: string, init: RequestInitEx = {}): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? 30_000
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: joinSignals(init.signal, timeoutMs),
    headers: {
      'User-Agent': USER_AGENT,
      Accept: '*/*',
      ...init.headers,
    },
  })
  if (!res.ok) {
    // 消费掉 body，避免连接泄漏
    await res.arrayBuffer().catch(() => undefined)
    throw new HttpError(`HTTP ${res.status} ${res.statusText} - ${url}`, res.status)
  }
  return res
}

export interface SourceResult<T> {
  data: T
  url: string
}

/** 依次尝试多个地址，返回第一个成功的结果 */
export async function getJsonFromSources<T>(
  urls: string[],
  init: RequestInitEx = {},
): Promise<SourceResult<T>> {
  const errors: string[] = []
  for (const url of urls) {
    try {
      const res = await fetchOnce(url, init)
      const text = await res.text()
      let data: T
      try {
        data = JSON.parse(text) as T
      } catch {
        throw new HttpError(`响应不是合法 JSON：${url}`)
      }
      return { data, url }
    } catch (error) {
      errors.push(errorText(error))
    }
  }
  throw new Error(`所有下载源均失败：${errors.join(' | ')}`)
}

export async function getTextFromSources(
  urls: string[],
  init: RequestInitEx = {},
): Promise<SourceResult<string>> {
  const errors: string[] = []
  for (const url of urls) {
    try {
      const res = await fetchOnce(url, init)
      return { data: await res.text(), url }
    } catch (error) {
      errors.push(errorText(error))
    }
  }
  throw new Error(`所有下载源均失败：${errors.join(' | ')}`)
}

export function errorText(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return '请求超时'
    if (error.name === 'AbortError') return '已取消'
    return error.message
  }
  return String(error)
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

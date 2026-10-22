/**
 * 极简 ZIP 读取/解压工具。
 * Node 没有内置 zip 支持，这里直接解析中央目录，用 zlib 处理 deflate。
 * 只读，不做压缩；仅支持 store(0) / deflate(8) 两种方法。
 */
import zlib from 'node:zlib'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

export interface ZipEntry {
  name: string
  /** 压缩后大小 */
  compressedSize: number
  /** 解压后大小 */
  size: number
  method: number
  /** 中央目录里的本地头偏移 */
  offset: number
  isDirectory: boolean
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

/** 读取 zip 中的条目表 */
export function readZipEntries(buffer: Buffer): ZipEntry[] {
  const eocd = findEocd(buffer)
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件（未找到中央目录）')
  const total = buffer.readUInt16LE(eocd + 10)
  const cdOffset = buffer.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []
  let pointer = cdOffset
  for (let index = 0; index < total; index++) {
    if (pointer + 46 > buffer.length) break
    if (buffer.readUInt32LE(pointer) !== CENTRAL_SIGNATURE) break
    const method = buffer.readUInt16LE(pointer + 10)
    const compressedSize = buffer.readUInt32LE(pointer + 20)
    const size = buffer.readUInt32LE(pointer + 24)
    const nameLength = buffer.readUInt16LE(pointer + 28)
    const extraLength = buffer.readUInt16LE(pointer + 30)
    const commentLength = buffer.readUInt16LE(pointer + 32)
    const offset = buffer.readUInt32LE(pointer + 42)
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength)
    entries.push({
      name,
      compressedSize,
      size,
      method,
      offset,
      isDirectory: name.endsWith('/'),
    })
    pointer += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function findEocd(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - 0xffff - 22)
  for (let offset = buffer.length - 22; offset >= start; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  return -1
}

/** 解出单个条目的内容 */
export function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  let pointer = entry.offset
  if (buffer.readUInt32LE(pointer) !== LOCAL_SIGNATURE) throw new Error(`ZIP 条目损坏：${entry.name}`)
  const nameLength = buffer.readUInt16LE(pointer + 26)
  const extraLength = buffer.readUInt16LE(pointer + 28)
  const dataStart = pointer + 30 + nameLength + extraLength
  const raw = buffer.subarray(dataStart, dataStart + entry.compressedSize)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) return zlib.inflateRawSync(raw)
  throw new Error(`不支持的压缩方法 ${entry.method}：${entry.name}`)
}

export function readZipText(buffer: Buffer, entries: ZipEntry[], name: string): string | null {
  const normalized = name.replace(/\\/g, '/').replace(/^\/+/, '')
  const entry = entries.find((item) => item.name.replace(/^\/+/, '') === normalized)
  if (!entry) return null
  return readZipEntry(buffer, entry).toString('utf8').replace(/^\uFEFF/, '')
}

export async function openZip(file: string): Promise<{ buffer: Buffer; entries: ZipEntry[] }> {
  const buffer = await fsp.readFile(file)
  return { buffer, entries: readZipEntries(buffer) }
}

/** 安全解压（阻止 zip-slip），返回写出的文件数 */
export async function extractZip(
  buffer: Buffer,
  entries: ZipEntry[],
  destDir: string,
  options: { filter?: (entry: ZipEntry) => boolean; prefix?: string; stripPrefix?: string } = {},
): Promise<number> {
  const root = path.resolve(destDir)
  let count = 0
  for (const entry of entries) {
    if (entry.isDirectory) continue
    if (options.prefix && !entry.name.startsWith(options.prefix)) continue
    if (options.filter && !options.filter(entry)) continue
    let relative = entry.name.replace(/\\/g, '/')
    if (options.stripPrefix && relative.startsWith(options.stripPrefix)) {
      relative = relative.slice(options.stripPrefix.length)
    }
    if (!relative) continue
    const target = path.resolve(root, relative)
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`ZIP 中包含非法路径：${entry.name}`)
    }
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, readZipEntry(buffer, entry))
    count++
  }
  return count
}

export function isZipFile(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r')
    const header = Buffer.alloc(4)
    fs.readSync(fd, header, 0, 4, 0)
    fs.closeSync(fd)
    return header.readUInt32LE(0) === LOCAL_SIGNATURE
  } catch {
    return false
  }
}
// ------------------------------------------------------------------ 写入（仅 store，测试与打包用）

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipWriteEntry {
  name: string
  data: Buffer | string
}

/** 生成一个不压缩的 zip 文件内容（只用于测试/合成整合包） */
export function createZip(entries: ZipWriteEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  const now = new Date()
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff

  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)

    locals.push(local, data)
    centrals.push(central)
    offset += local.length + data.length
  }

  const centralBuffer = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralBuffer, eocd])
}

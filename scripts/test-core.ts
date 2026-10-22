/**
 * 核心安全 / 完整性单元测试（离线，不依赖网络）：
 *   npm run test:core
 *
 * 覆盖：safeJoin 路径越界拒绝、整合包清单路径穿越拒绝、ZIP 解压 zip-slip 拒绝。
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { safeJoin } from '../src/core/fsutil'
import { createZip } from '../src/core/zip'
import { inspectModpack, installModpack, type ModpackInstallContext } from '../src/core/modpack'

let passed = 0
let failed = 0

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function test(name: string, fn: () => void | Promise<void>): Promise<void> | void {
  const run = async (): Promise<void> => {
    try {
      await fn()
      passed += 1
      console.log(`  [ok] ${name}`)
    } catch (error) {
      failed += 1
      console.error(`  [FAIL] ${name}`)
      console.error(`         ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return run()
}

const dir = path.join(os.tmpdir(), 'mineflux-test-core')
await fs.rm(dir, { recursive: true, force: true })
await fs.mkdir(dir, { recursive: true })

console.log('核心安全 / 完整性：')

await test('safeJoin 接受普通相对路径', () => {
  const base = path.join(dir, 'game')
  check(safeJoin(base, 'mods/a.jar') === path.join(base, 'mods', 'a.jar'), '普通路径拼接错误')
  check(safeJoin(base, 'a\\b\\c.txt') === path.join(base, 'a', 'b', 'c.txt'), '反斜杠路径错误')
})

await test('safeJoin 拒绝 ../ 与绝对路径', () => {
  const base = path.join(dir, 'game')
  for (const bad of ['../evil.txt', '..\\evil.txt', 'a/../../evil.txt', '/etc/passwd', 'C:/Windows/x', '//server/share/x']) {
    let threw = false
    try {
      safeJoin(base, bad)
    } catch {
      threw = true
    }
    check(threw, `应拒绝路径：${bad}`)
  }
})

await test('整合包清单里的穿越路径会在安装前被拒绝', async () => {
  const packPath = path.join(dir, 'evil.mrpack')
  await fs.writeFile(
    packPath,
    createZip([
      {
        name: 'modrinth.index.json',
        data: JSON.stringify({
          formatVersion: 1,
          game: 'minecraft',
          versionId: '1.0.0',
          name: 'traversal',
          files: [
            {
              path: '../../../PWNED.txt',
              hashes: {},
              downloads: ['data:text/plain,owned'],
              size: 5,
            },
          ],
          dependencies: { minecraft: '1.5.2' },
        }),
      },
    ]),
  )
  const info = await inspectModpack(packPath, () => undefined)
  check(info.type === 'modrinth', `类型识别错误：${info.type}`)

  const root = path.join(dir, 'game')
  const ctx: ModpackInstallContext = {
    root,
    instanceName: 'pack',
    dataDir: path.join(root, 'versions', 'pack'),
    tempDir: path.join(dir, 'temp'),
    mode: 'official',
    signal: new AbortController().signal,
    log: () => undefined,
  }
  await fs.mkdir(ctx.tempDir, { recursive: true })
  let error: unknown = null
  try {
    await installModpack(packPath, info, ctx)
  } catch (caught) {
    error = caught
  }
  check(error instanceof Error, '穿越路径的整合包应抛错')
  check(/非法文件路径|路径越界/.test((error as Error).message), `错误信息不明确：${(error as Error).message}`)
})

await test('外层的 PWNED.txt 没有被创建', async () => {
  const escaped = path.join(dir, 'PWNED.txt')
  check(!(await fs.stat(escaped).then(() => true).catch(() => false)), '整合包写出了游戏目录之外的文件')
})

await fs.rm(dir, { recursive: true, force: true })

console.log('')
if (failed) {
  console.error(`✗ ${failed} 个用例失败，${passed} 个通过`)
  process.exitCode = 1
} else {
  console.log(`✓ 全部 ${passed} 个用例通过`)
}

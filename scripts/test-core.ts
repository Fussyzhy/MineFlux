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
import { formatBytes, formatSpeed, percent } from '../src/renderer/lib/format'
import { createZip } from '../src/core/zip'
import { inspectModpack, installModpack, type ModpackInstallContext } from '../src/core/modpack'
import {
  detectJava,
  getManualJava,
  parseMajor,
  prefersManualJava,
  resolveJavaExecutable,
  setManualJava,
} from '../src/core/java'

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

await test('进度格式化不会出现 undefined 单位', () => {
  check(formatBytes(0.157) === '0 B', `亚字节应显示 0 B，实际：${formatBytes(0.157)}`)
  check(formatBytes(0.9) === '0 B', `亚字节应显示 0 B，实际：${formatBytes(0.9)}`)
  check(formatBytes(161) === '161 B', `161 字节显示错误：${formatBytes(161)}`)
  check(formatBytes(1024) === '1.0 KB', `1024 字节显示错误：${formatBytes(1024)}`)
  check(formatSpeed(0.157) === '0 B/s', `亚字节速度应显示 0 B/s，实际：${formatSpeed(0.157)}`)
  check(formatSpeed(1.2) === '1 B/s', `1.2 B/s 显示错误：${formatSpeed(1.2)}`)
  check(formatSpeed(161 * 1024) === '161 KB/s', `161 KB/s 显示错误：${formatSpeed(161 * 1024)}`)
})

await test('进度百分比始终限制在 0~100', () => {
  check(percent(200, 100) === 100, `超出总量应封顶 100：${percent(200, 100)}`)
  check(percent(50, 0) === 0, `总量为 0 时应为 0：${percent(50, 0)}`)
  check(percent(-10, 100) === 0, `负数应夹到 0：${percent(-10, 100)}`)
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

// ------------------------------------------------------------------ 手动配置的 Java

const exeName = process.platform === 'win32' ? 'java.exe' : 'java'
const javaRoot = path.join(dir, 'jdk-21')

await test('手动 Java 路径支持 java.exe / JDK 根目录 / bin 目录三种写法', async () => {
  await fs.mkdir(path.join(javaRoot, 'bin'), { recursive: true })
  const file = path.join(javaRoot, 'bin', exeName)
  await fs.writeFile(file, '')
  check(resolveJavaExecutable(file) === file, '直接指向 java.exe 时不应改动路径')
  check(resolveJavaExecutable(javaRoot) === file, 'JDK 根目录应自动补 bin/java.exe')
  check(resolveJavaExecutable(path.join(javaRoot, 'bin')) === file, 'bin 目录应自动补 java.exe')
  check(resolveJavaExecutable(`"${javaRoot}"`) === file, '带引号的路径应被接受')
})

await test('手动 Java 路径为空 / 不存在时解析为空串', () => {
  check(resolveJavaExecutable('') === '', '空路径应返回空串')
  check(resolveJavaExecutable('   ') === '', '纯空白应返回空串')
  check(resolveJavaExecutable(path.join(dir, 'not-exist')) === '', '不存在的路径应返回空串')
})

await test('手动 Java 不会被当成可用的 Java 运行', async () => {
  // 假 java.exe 无法真正运行，这里验证「记忆」且不会把假路径当成可用 Java
  setManualJava({ path: javaRoot, prefer: true })
  check(prefersManualJava(), '应记住「优先手动」')
  check(getManualJava()?.path === javaRoot, '应记住手动路径')
  const all = await detectJava(true)
  check(!all.some((item) => item.source === '手动配置'), '无法运行的假 java 不应出现在检测结果里')
  setManualJava(null)
  check(getManualJava() === null, '清除后应为空')
  check(!prefersManualJava(), '清除后不应再优先手动')
})

await test('设置手动 Java 会让检测缓存失效', async () => {
  await detectJava(true)
  setManualJava({ path: javaRoot, prefer: false })
  const first = await detectJava()
  setManualJava(null)
  const second = await detectJava()
  check(first !== second, '手动 Java 变化后应重新扫描而不是返回旧缓存')
})

await test('parseMajor 兼容 1.x 与 21.x', () => {
  check(parseMajor('1.8.0_412') === 8, 'Java 8 主版本解析错误')
  check(parseMajor('21.0.5') === 21, 'Java 21 主版本解析错误')
  check(parseMajor('') === 0, '空版本应为 0')
})

await fs.rm(dir, { recursive: true, force: true })

console.log('')
if (failed) {
  console.error(`✗ ${failed} 个用例失败，${passed} 个通过`)
  process.exitCode = 1
} else {
  console.log(`✓ 全部 ${passed} 个用例通过`)
}

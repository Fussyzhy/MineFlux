/**
 * 端到端测试脚本（不依赖 Electron）：
 *   yarn run e2e -- plan 1.8.9       查看下载清单与体积
 *   yarn run e2e -- install 1.8.9    真实下载到 %TEMP%/mineflux-e2e/1.8.9
 *   yarn run e2e -- verify 1.8.9     全量校验已下载文件
 */
import os from 'node:os'
import path from 'node:path'
import { InstallTask, verifyFileSha1 } from '../src/core/install'
import { getJsonFromSources, getTextFromSources } from '../src/core/http'
import { fetchVersionManifest } from '../src/core/manifest'
import { metaUrls } from '../src/core/mirror'
import { detectRuleContext } from '../src/core/rules'
import {
  buildAssetPlan,
  buildBasePlan,
  type AssetIndexJson,
  type PlannedFile,
  type RawVersion,
} from '../src/core/version'

/** 新环境变量名优先，兼容旧名 MCDL_* */
const envValue = (name: string): string | undefined =>
  process.env[`MINEFLUX_${name}`] ?? process.env[`MCDL_${name}`]
const MODE = (envValue('MODE') as 'auto' | 'official' | 'mirror') ?? 'auto'
const [command, versionIdArg] = process.argv.slice(2)
const versionId = versionIdArg ?? '1.21.4'
const root = path.join(os.tmpdir(), 'mineflux-e2e', versionId)

function bytes(value: number): string {
  if (value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** index).toFixed(1)} ${units[index]}`
}

async function resolvePlan(): Promise<{ files: PlannedFile[]; assetFiles: PlannedFile[] }> {
  const manifest = await fetchVersionManifest(MODE)
  const version = manifest.versions.find((item) => item.id === versionId)
  if (!version) throw new Error(`未找到版本 ${versionId}`)
  const rawText = (await getTextFromSources(metaUrls(version.url, MODE))).data
  const raw = JSON.parse(rawText) as RawVersion
  const base = buildBasePlan({
    root,
    versionId,
    versionUrl: version.url,
    versionSha1: version.sha1,
    raw,
    mode: MODE,
    ctx: detectRuleContext(),
  })
  let assetFiles: PlannedFile[] = []
  if (raw.assetIndex?.url) {
    const indexJson = (
      await getJsonFromSources<AssetIndexJson>(metaUrls(raw.assetIndex.url, MODE))
    ).data
    assetFiles = buildAssetPlan({ root, index: indexJson, mode: MODE }).files
  }
  return { files: [...base.files, ...assetFiles], assetFiles }
}

async function main(): Promise<void> {
  if (!command) {
    console.log('用法: e2e <plan|install|verify|stress> [versionId]')
    return
  }

  if (command === 'plan') {
    const { files, assetFiles } = await resolvePlan()
    const total = files.reduce((sum, file) => sum + Math.max(0, file.size), 0)
    const groups = new Map<string, { count: number; size: number }>()
    for (const file of files) {
      const group = groups.get(file.kind) ?? { count: 0, size: 0 }
      group.count++
      group.size += Math.max(0, file.size)
      groups.set(file.kind, group)
    }
    console.log(`版本 ${versionId}  源=${MODE}  目标目录=${root}`)
    console.log(`总计 ${files.length} 个文件 / ${bytes(total)} (${total} bytes)`)
    for (const [kind, group] of groups) {
      console.log(`  ${kind.padEnd(12)} ${String(group.count).padStart(5)} 个  ${bytes(group.size)}`)
    }
    console.log(`  资源对象 ${assetFiles.length} 个`)
    const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 5)
    for (const file of largest) {
      console.log(`  最大: ${bytes(file.size).padStart(9)}  ${path.relative(root, file.dest)}`)
    }
    return
  }

  if (command === 'install') {
    const manifest = await fetchVersionManifest(MODE)
    const version = manifest.versions.find((item) => item.id === versionId)
    if (!version) throw new Error(`未找到版本 ${versionId}`)
    const task = new InstallTask(
      {
        kind: 'version',
        versionId: version.id,
        versionUrl: version.url,
        versionSha1: version.sha1,
        root,
        instanceName: envValue('INSTANCE') ?? version.id,
        mode: MODE,
        concurrency: Number(envValue('CONCURRENCY') ?? 24),
        verifyHashes: true,
        manifestSource: manifest.source,
        isolation: true,
      },
      {
        emitSnapshot: (snapshot) => {
          const percent = snapshot.totalBytes
            ? ((snapshot.doneBytes / snapshot.totalBytes) * 100).toFixed(1)
            : '0.0'
          process.stdout.write(
            `\r[${snapshot.state}] ${percent}%  ${bytes(snapshot.doneBytes)}/${bytes(
              snapshot.totalBytes,
            )}  ${bytes(snapshot.speed)}/s  ${snapshot.doneFiles}/${snapshot.totalFiles} 个文件   `,
          )
          if (snapshot.state === 'finished' || snapshot.state === 'failed') {
            process.stdout.write('\n')
          }
        },
        emitLog: (line) => {
          process.stdout.write(`\n[${line.level}] ${line.text}\n`)
        },
      },
    )
    await task.start()
    const snapshot = task.getSnapshot()
    if (snapshot.failures.length) {
      console.error(`失败 ${snapshot.failures.length} 个文件`)
      for (const failure of snapshot.failures.slice(0, 10)) {
        console.error(` - ${failure.path}: ${failure.error}`)
      }
      process.exitCode = 1
    } else {
      console.log(`安装完成：${snapshot.doneFiles}/${snapshot.totalFiles} 个文件 → ${root}`)
    }
    return
  }

  if (command === 'verify') {
    const { files } = await resolvePlan()
    let failed = 0
    let checked = 0
    for (const file of files) {
      const fs = await import('node:fs/promises')
      try {
        const stat = await fs.stat(file.dest)
        if (file.size >= 0 && stat.size !== file.size) throw new Error(`大小 ${stat.size}/${file.size}`)
        if (file.sha1) {
          if (!(await verifyFileSha1(file.dest, file.sha1))) throw new Error('SHA1 不匹配')
        }
        checked++
      } catch (error) {
        failed++
        console.error(`✗ ${path.relative(root, file.dest)}: ${(error as Error).message}`)
      }
    }
    console.log(`校验完成：${checked} 个通过，${failed} 个失败`)
    if (failed) process.exitCode = 1
    return
  }

  if (command === 'stress') {
    const fs = await import('node:fs/promises')
    const manifest = await fetchVersionManifest('official')
    const version = manifest.versions.find((item) => item.id === versionId)
    if (!version) throw new Error(`未找到版本 ${versionId}`)
    const root = path.join(os.tmpdir(), 'mineflux-stress', versionId)
    await fs.rm(root, { recursive: true, force: true })

    const makeTask = (verifyHashes: boolean) =>
      new InstallTask(
        {
          kind: 'version',
          versionId: version.id,
          versionUrl: version.url,
          versionSha1: version.sha1,
          root,
          instanceName: version.id,
          isolation: true,
          mode: 'official',
          concurrency: 8,
          verifyHashes,
          manifestSource: 'mojang',
        },
        {
          emitSnapshot: () => undefined,
          emitLog: (line) => console.log(`  [${line.level}] ${line.text}`),
        },
      )

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const terminal = ['finished', 'failed', 'canceled']
    const waitTerminal = async (target: InstallTask, timeoutMs = 900_000) => {
      const end = Date.now() + timeoutMs
      while (Date.now() < end) {
        const snapshot = target.getSnapshot()
        if (terminal.includes(snapshot.state)) return snapshot
        await sleep(200)
      }
      throw new Error(`等待任务结束超时（当前状态 ${target.getSnapshot().state}）`)
    }
    console.log('1) 暂停 / 继续')
    const task = makeTask(true)
    void task.start()
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline && task.getSnapshot().doneBytes < 2 * 1024 * 1024) {
      await sleep(200)
    }
    task.pause()
    await sleep(400)
    const paused = task.getSnapshot()
    const bytesAtPause = paused.doneBytes
    await sleep(1500)
    const afterPause = task.getSnapshot()
    const drift = afterPause.doneBytes - bytesAtPause
    console.log(`   state=${paused.state} 暂停后新增=${bytes(bytesAtPause)} 后续增量=${drift} bytes`)
    if (paused.state !== 'paused') throw new Error('暂停状态不正确')
    if (drift > 512 * 1024) throw new Error(`暂停后仍在大量下载：${drift} bytes`)
    task.resume()
    const final = await waitTerminal(task)
    console.log(
      `   继续后 state=${final.state} ${final.doneFiles}/${final.totalFiles} 文件 ${bytes(final.doneBytes)}`,
    )
    if (final.state !== 'finished') throw new Error(`未正常完成：${final.state}`)
    if (final.doneBytes !== final.totalBytes) {
      throw new Error(`完成时进度不是 100%：${final.doneBytes}/${final.totalBytes}`)
    }

    console.log('2) 重复安装（应全部跳过）')
    const again = makeTask(true)
    const againStarted = Date.now()
    await again.start()
    const againSnapshot = again.getSnapshot()
    const againMs = Date.now() - againStarted
    console.log(`   state=${againSnapshot.state} 用时 ${againMs}ms 跳过=${bytes(againSnapshot.doneBytes)}`)
    if (againSnapshot.state !== 'finished') throw new Error('重复安装失败')
    if (againSnapshot.failures.length) throw new Error(`重复安装出现失败：${againSnapshot.failures.length}`)
    if (againMs > 30_000) throw new Error(`重复安装耗时过长：${againMs}ms`)

    console.log('3) 取消')
    const cancelRoot = `${root}-cancel`
    await fs.rm(cancelRoot, { recursive: true, force: true })
    const cancelTask = new InstallTask(
      {
        kind: 'version',
        versionId: version.id,
        versionUrl: version.url,
        versionSha1: version.sha1,
        root: cancelRoot,
        instanceName: version.id,
        isolation: true,
        mode: 'official',
        concurrency: 8,
        verifyHashes: true,
        manifestSource: 'mojang',
      },
      { emitSnapshot: () => undefined, emitLog: () => undefined },
    )
    void cancelTask.start()
    const cancelDeadline = Date.now() + 90_000
    while (Date.now() < cancelDeadline && cancelTask.getSnapshot().doneBytes < 512 * 1024) {
      await sleep(200)
    }
    cancelTask.cancel()
    const cancelled = await waitTerminal(cancelTask)
    console.log(`   state=${cancelled.state}`)
    if (cancelled.state !== 'canceled') throw new Error(`取消状态不正确：${cancelled.state}`)
    const leftovers = (await fs.readdir(cancelRoot, { recursive: true })).filter((name) =>
      String(name).endsWith('.part'),
    )
    console.log(`   残留 .part 文件 ${leftovers.length} 个`)
    await fs.rm(cancelRoot, { recursive: true, force: true })

    console.log('全部通过 ✔')
    return
  }

  console.error(`未知命令：${command}`)
  process.exitCode = 1
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})



/**
 * 加载器 / 实例 / 整合包 功能验证（不依赖 Electron）：
 *   yarn e2e:features
 *
 * 覆盖：
 *   1. inheritsFrom 合并与实例 JSON 规范化
 *   2. buildBasePlan 的实例目录 / jar / files 规划
 *   3. Fabric / Quilt 版本列表 + profile 获取
 *   4. Fabric 合并后的下载清单包含 loader 库
 *   5. 旧版 Forge（1.12.2）安装器解包（无需 Java）
 *   6. OptiFine 1.12.2 Java-free 安装（方法 B）
 *   7. LiteLoader 版本列表 + profile
 *   8. NeoForge 版本列表
 *   9. 整合包识别与解压（Modrinth / HMCL / MMC / MCBBS / CF manifest）
 *  10. 完整 InstallTask：自定义实例名 + 版本隔离 + 安装清单
 */
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { prepareLoader, listLoaderVersions } from '../src/core/loaders'
import type { LoaderContext } from '../src/core/loaders/types'
import { mergeVersionJson, normalizeInstanceJson, type RawVersion } from '../src/core/version-json'
import { buildBasePlan } from '../src/core/version'
import { detectRuleContext } from '../src/core/rules'
import { inspectModpack, installModpack } from '../src/core/modpack'
import { createZip } from '../src/core/zip'
import { fetchVersionManifest } from '../src/core/manifest'
import { getTextFromSources } from '../src/core/http'
import { metaUrls } from '../src/core/mirror'
import { InstallTask } from '../src/core/install'
import { dataDirOf, listInstances, readManifest } from '../src/core/instance'
import type { InstallRequest } from '../src/shared/types'

const MODE = 'official' as const
const baseDir = path.join(os.tmpdir(), 'mineflux-features')

let passed = 0
let failed = 0
const failures: Array<{ name: string; error: string }> = []

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

async function download(urls: string[], dest: string, minSize = 0): Promise<void> {
  let lastError: unknown = new Error('没有可用的下载地址')
  for (const url of urls) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length < minSize) throw new Error(`文件过小：${buffer.length} < ${minSize}`)
      await fsp.mkdir(path.dirname(dest), { recursive: true })
      await fsp.writeFile(dest, buffer)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function makeCtx(root: string, instanceName: string, mcVersion: string): LoaderContext {
  return {
    root,
    instanceName,
    mcVersion,
    mode: MODE,
    signal: AbortSignal.timeout(600_000),
    tempDir: path.join(root, '.tmp-install'),
    log: (level, text) => console.log(`      [${level}] ${text}`),
    fetchFile: (urls, dest, options) => download(urls, dest, options?.minSize ?? 0),
    runInstaller: async () => {
      throw new Error('这台机器没有安装 Java')
    },
  }
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const started = Date.now()
  process.stdout.write(`▶ ${name} … `)
  try {
    await fn()
    passed++
    console.log(`通过（${Date.now() - started}ms）`)
  } catch (error) {
    failed++
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    failures.push({ name, error: message })
    console.log(`失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

const fakeArtifact = (dest: string): RawVersion['libraries'] =>
  [
    {
      name: 'net.example:demo:1.0',
      downloads: {
        artifact: { path: dest, url: '', sha1: '0'.repeat(40), size: 10 },
      },
    },
  ]

function syntheticRaw(id: string): RawVersion {
  return {
    id,
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    libraries: fakeArtifact('net/example/demo/1.0/demo-1.0.jar'),
    assetIndex: { id: 'legacy', sha1: '0'.repeat(40), size: 10, url: '' },
    assets: 'legacy',
    downloads: {
      client: { url: 'https://example.invalid/client.jar', sha1: '0'.repeat(40), size: 10 },
    },
  }
}

async function main(): Promise<void> {
  await fsp.rm(baseDir, { recursive: true, force: true })
  await fsp.mkdir(baseDir, { recursive: true })

  // ---------------------------------------------------------------- 1. 合并
  await test('inheritsFrom 合并 / 实例 JSON 规范化', async () => {
    const base = {
      id: '1.20.1',
      mainClass: 'net.minecraft.client.main.Main',
      minecraftArguments: '--username Player --gameDir .',
      libraries: fakeArtifact('a/b/1/b-1.jar'),
    } as RawVersion
    const overlay = {
      id: '1.20.1-forge',
      inheritsFrom: '1.20.1',
      mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
      libraries: fakeArtifact('c/d/2/d-2.jar'),
      arguments: { game: ['--tweakClass', 'x'] },
    } as RawVersion
    const merged = mergeVersionJson(base, overlay)
    check(merged.mainClass === 'cpw.mods.bootstraplauncher.BootstrapLauncher', 'mainClass 未被覆盖')
    check((merged.libraries ?? []).length === 2, 'libraries 未合并')
    const normalized = normalizeInstanceJson(merged, 'MyInstance')
    check(normalized.id === 'MyInstance', `id 未改写：${String(normalized.id)}`)
    check(!('inheritsFrom' in normalized), 'inheritsFrom 未移除')
    check(!('jar' in normalized), 'jar 未移除')
  })

  // ---------------------------------------------------------------- 2. 计划
  await test('buildBasePlan 生成实例路径与下载清单', async () => {
    const root = path.join(baseDir, 'plan')
    const plan = buildBasePlan({
      root,
      versionId: '1.8.9',
      instanceName: 'MyInst',
      raw: syntheticRaw('1.8.9'),
      mode: MODE,
      ctx: detectRuleContext(),
      instanceJson: { sha1: '1'.repeat(40), size: 2 },
      wantVanillaJson: true,
    })
    check(plan.instanceJsonPath.endsWith(path.join('versions', 'MyInst', 'MyInst.json')), '实例 JSON 路径错误')
    check(plan.clientJarPath.endsWith(path.join('versions', '1.8.9', '1.8.9.jar')), '原版 jar 路径错误')
    check(plan.instanceJarPath.endsWith(path.join('versions', 'MyInst', 'MyInst.jar')), '实例 jar 路径错误')
    const kinds = new Set(plan.files.map((file) => file.kind))
    check(kinds.has('versionJson') && kinds.has('client') && kinds.has('library'), `缺少文件类型：${[...kinds]}`)
  })

  await test('buildBasePlan 指定工作区时原版文件落工作区、libraries 仍共享', async () => {
    const root = path.join(baseDir, 'plan-work')
    const work = path.join(root, '.work')
    const plan = buildBasePlan({
      root,
      workRoot: work,
      versionId: '1.8.9',
      instanceName: 'WorkInst',
      raw: syntheticRaw('1.8.9'),
      mode: MODE,
      ctx: detectRuleContext(),
      instanceJson: { sha1: '3'.repeat(40), size: 2 },
      wantVanillaJson: false,
    })
    check(plan.clientJarPath === path.join(work, 'versions', '1.8.9', '1.8.9.jar'), '原版 jar 应落在工作区')
    check(
      plan.files.some((file) => file.dest === path.join(work, 'versions', 'WorkInst', 'WorkInst.json')),
      '实例 JSON 应落在工作区',
    )
    const libraries = plan.files.filter((file) => file.kind === 'library')
    check(libraries.length > 0, '计划里没有库文件')
    check(
      libraries.every((file) => file.dest.startsWith(path.join(root, 'libraries'))),
      'libraries 应写在真实游戏目录（多实例共享）',
    )
    check(
      plan.files.every((file) => file.kind === 'library' || file.dest.startsWith(work)),
      '除 libraries 外的文件都应落在工作区',
    )
  })

  // ---------------------------------------------------------------- 3. Fabric
  let fabricVersion = ''
  await test('Fabric 版本列表 + profile', async () => {
    const root = path.join(baseDir, 'fabric')
    const list = await listLoaderVersions('fabric', { mcVersion: '1.21.4', mode: MODE })
    check(list.versions.length > 0, 'Fabric 版本列表为空')
    fabricVersion = list.versions.find((item) => item.recommended)?.version ?? list.versions[0].version
    const result = await prepareLoader('fabric', fabricVersion, makeCtx(root, 'fabric-1.21.4', '1.21.4'))
    check(result.profile.mainClass === 'net.fabricmc.loader.impl.launch.knot.KnotClient', 'Fabric mainClass 异常')
    check(result.profile.inheritsFrom === '1.21.4', 'Fabric profile 缺少 inheritsFrom')
    check((result.profile.libraries ?? []).length > 0, 'Fabric profile 没有 libraries')
    console.log(`      loader=${fabricVersion} 库=${result.profile.libraries?.length}`)
  })

  // ---------------------------------------------------------------- 4. Fabric 合并计划
  await test('Fabric 合并后下载清单包含 loader 库', async () => {
    const root = path.join(baseDir, 'fabric-plan')
    const manifest = await fetchVersionManifest(MODE)
    const version = manifest.versions.find((item) => item.id === '1.21.4')
    check(version, '版本清单里找不到 1.21.4')
    const raw = JSON.parse((await getTextFromSources(metaUrls(version!.url, MODE))).data) as RawVersion
    const ctx = makeCtx(root, 'FabricInst', '1.21.4')
    const result = await prepareLoader('fabric', fabricVersion, ctx)
    const merged = normalizeInstanceJson(mergeVersionJson(raw, result.profile), 'FabricInst')
    const plan = buildBasePlan({
      root,
      versionId: '1.21.4',
      instanceName: 'FabricInst',
      versionUrl: version!.url,
      versionSha1: version!.sha1,
      raw: merged,
      mode: MODE,
      ctx: detectRuleContext(),
      instanceJson: { sha1: '2'.repeat(40), size: 2 },
    })
    const loader = plan.files.filter((file) => file.dest.includes(`fabric-loader${path.sep}`))
    check(loader.length > 0, '计划里缺少 fabric-loader 库')
    check(plan.files.some((file) => file.dest.endsWith(path.join('versions', '1.21.4', '1.21.4.json'))), '缺少原版 JSON')
    console.log(`      fabric 库文件=${loader.length} 总量=${plan.files.length}`)
  })

  // ---------------------------------------------------------------- 5. Forge 旧版
  await test('Forge 1.12.2 安装器解包（无需 Java）', async () => {
    const root = path.join(baseDir, 'forge-legacy')
    const list = await listLoaderVersions('forge', { mcVersion: '1.12.2', mode: MODE })
    check(list.versions.length > 0, 'Forge 版本列表为空')
    const version = list.versions.find((item) => item.version.includes('14.23.5.2859'))?.version ?? list.versions[0].version
    const ctx = makeCtx(root, 'ForgeLegacy', '1.12.2')
    const result = await prepareLoader('forge', version, ctx)
    check(result.profile.inheritsFrom === '1.12.2', `inheritsFrom 异常：${String(result.profile.inheritsFrom)}`)
    check(
      String(result.profile.mainClass ?? '').includes('launchwrapper'),
      `mainClass 异常：${String(result.profile.mainClass)}`,
    )
    const universal = path.join(root, 'libraries', 'net', 'minecraftforge', 'forge')
    check(fs.existsSync(universal), 'Forge 本体没有释放到 libraries')
    const released = await fsp.readdir(universal, { recursive: true })
    console.log(`      loader=${version} 释放=${released.length} 项`)
  })

  // ---------------------------------------------------------------- 6. OptiFine
  await test('OptiFine 1.12.2 免 Java 安装（方法 B）', async () => {
    const root = path.join(baseDir, 'optifine')
    const list = await listLoaderVersions('optifine', { mcVersion: '1.12.2', mode: MODE })
    check(list.versions.length > 0, 'OptiFine 版本列表为空')
    const version =
      list.versions.find((item) => item.version === 'HD_U_G5')?.version ??
      list.versions.find((item) => item.version.includes('HD_U'))?.version ??
      list.versions[0].version
    const ctx = makeCtx(root, 'OptiFineLegacy', '1.12.2')
    const result = await prepareLoader('optifine', version, ctx)
    check(
      String(result.profile.mainClass ?? '').includes('launchwrapper'),
      `mainClass 异常：${String(result.profile.mainClass)}`,
    )
    const lib = (result.profile.libraries ?? []).find((item) => item.name.startsWith('optifine:OptiFine'))
    check(lib, 'profile 里缺少 optifine:OptiFine 库')
    const relative = lib!.downloads?.artifact?.path
    check(relative, 'optifine 库缺少 path')
    check(fs.existsSync(path.join(root, 'libraries', relative!)), 'OptiFine jar 没有写入 libraries')
    console.log(`      version=${version} 库=${relative}`)
  })

  // ---------------------------------------------------------------- 7. LiteLoader
  await test('LiteLoader 版本列表 + profile', async () => {
    let list
    try {
      list = await listLoaderVersions('liteloader', { mcVersion: '1.7.10', mode: MODE })
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      // dl.liteloader.com 只有官方源，偶发 Cloudflare 5xx；此时跳过而不是判失败
      if (/HTTP 5\d\d/.test(text)) {
        console.log(`      跳过：LiteLoader 官方源暂时不可用（${text}）`)
        return
      }
      throw error
    }
    check(list.versions.length > 0, 'LiteLoader 版本列表为空')
    const version = list.versions[0].version
    const root = path.join(baseDir, 'liteloader')
    const ctx = makeCtx(root, 'LiteLoader1710', '1.7.10')
    const result = await prepareLoader('liteloader', version, ctx)
    const lib = (result.profile.libraries ?? []).find((item) => item.name.startsWith('com.mumfrey:liteloader'))
    check(lib, 'profile 里缺少 com.mumfrey:liteloader')
    check(result.profile.inheritsFrom === '1.7.10', 'LiteLoader profile 缺少 inheritsFrom')
    console.log(`      version=${version}`)
  })

  // ---------------------------------------------------------------- 8. NeoForge 列表
  await test('NeoForge 版本列表', async () => {
    const list = await listLoaderVersions('neoforge', { mcVersion: '1.21.4', mode: MODE })
    check(list.versions.length > 0, 'NeoForge 版本列表为空')
    console.log(`      示例=${list.versions[0].version}（共 ${list.versions.length} 个）`)
  })

  // ---------------------------------------------------------------- 9. 整合包
  await test('整合包识别 + 解压（多格式）', async () => {
    const dir = path.join(baseDir, 'packs')
    await fsp.mkdir(dir, { recursive: true })

    const sha1 = (text: string): string => crypto.createHash('sha1').update(text).digest('hex')
    const modrinth = createZip([
      {
        name: 'modrinth.index.json',
        data: JSON.stringify({
          formatVersion: 1,
          game: 'minecraft',
          versionId: '1.0.0',
          name: 'Feature Pack',
          dependencies: { minecraft: '1.21.4', 'fabric-loader': fabricVersion },
          files: [
            {
              path: 'mods/hello.jar',
              hashes: { sha1: sha1('hello') },
              size: 5,
              downloads: ['https://example.invalid/hello.jar'],
            },
          ],
        }),
      },
      { name: 'overrides/config/test.txt', data: 'from-overrides' },
      { name: 'overrides/mods/bundled.jar', data: 'bundled' },
    ])
    const modrinthFile = path.join(dir, 'pack.mrpack')
    await fsp.writeFile(modrinthFile, modrinth)

    const info = await inspectModpack(modrinthFile)
    check(info.type === 'modrinth', `类型识别错误：${info.type}`)
    check(info.mcVersion === '1.21.4', `MC 版本错误：${String(info.mcVersion)}`)
    check(info.components.fabric === fabricVersion, 'Fabric 版本丢失')

    const target = path.join(dir, 'installed')
    const result = await installModpack(modrinthFile, info, {
      root: target,
      instanceName: 'Feature Pack',
      dataDir: path.join(target, 'versions', 'Feature Pack'),
      tempDir: path.join(baseDir, 'tmp'),
      mode: MODE,
      signal: AbortSignal.timeout(120_000),
      log: () => undefined,
    })
    check(result.downloads.length === 1, `待下载文件数异常：${result.downloads.length}`)
    check(
      result.downloads[0].relativePath.replace(/\\/g, '/') === 'mods/hello.jar',
      `下载路径异常：${result.downloads[0].relativePath}`,
    )
    check(result.extracted > 0, 'overrides 未解压')
    const overridesFile = path.join(target, 'versions', 'Feature Pack', 'config', 'test.txt')
    check(fs.existsSync(overridesFile), `overrides 未写入：${overridesFile}`)
    check(fs.existsSync(path.join(target, 'versions', 'Feature Pack', 'mods', 'bundled.jar')), '内置 mod 未解压')

    // HMCL
    const hmclFile = path.join(dir, 'hmcl.zip')
    await fsp.writeFile(
      hmclFile,
      createZip([
        { name: 'modpack.json', data: JSON.stringify({ name: 'HMCL Pack', gameVersion: '1.16.5' }) },
        { name: 'minecraft/config/a.txt', data: 'a' },
      ]),
    )
    const hmcl = await inspectModpack(hmclFile)
    check(hmcl.type === 'hmcl', `HMCL 类型识别错误：${hmcl.type}`)
    check(hmcl.mcVersion === '1.16.5', `HMCL MC 版本错误：${String(hmcl.mcVersion)}`)

    // MultiMC
    const mmcFile = path.join(dir, 'mmc.zip')
    await fsp.writeFile(
      mmcFile,
      createZip([
        {
          name: 'mmc-pack.json',
          data: JSON.stringify({
            formatVersion: 1,
            components: [
              { uid: 'net.minecraft', version: '1.20.1' },
              { uid: 'net.minecraftforge', version: '47.2.0' },
            ],
          }),
        },
        { name: 'instance.cfg', data: 'name=MMC Pack\n' },
        { name: 'minecraft/config/b.txt', data: 'b' },
      ]),
    )
    const mmc = await inspectModpack(mmcFile)
    check(mmc.type === 'mmc', `MMC 类型识别错误：${mmc.type}`)
    check(mmc.mcVersion === '1.20.1' && mmc.components.forge === '47.2.0', 'MMC 组件解析错误')

    // MCBBS
    const mcbbsFile = path.join(dir, 'mcbbs.zip')
    await fsp.writeFile(
      mcbbsFile,
      createZip([
        {
          name: 'mcbbs.packmeta',
          data: JSON.stringify({
            name: 'MCBBS Pack',
            version: '2',
            addons: { game: '1.12.2', forge: '14.23.5.2859' },
          }),
        },
        { name: 'overrides/config/c.txt', data: 'c' },
      ]),
    )
    const mcbbs = await inspectModpack(mcbbsFile)
    check(mcbbs.type === 'mcbbs', `MCBBS 类型识别错误：${mcbbs.type}`)
    check(mcbbs.components.forge === '14.23.5.2859', 'MCBBS Forge 解析错误')

    // CurseForge manifest
    const cfFile = path.join(dir, 'cf.zip')
    await fsp.writeFile(
      cfFile,
      createZip([
        {
          name: 'manifest.json',
          data: JSON.stringify({
            manifestType: 'minecraftModpack',
            manifestVersion: 1,
            name: 'CF Pack',
            version: '1.0',
            minecraft: {
              version: '1.19.2',
              modLoaders: [{ id: 'forge-43.2.0', primary: true }],
            },
            files: [],
          }),
        },
        { name: 'overrides/config/d.txt', data: 'd' },
      ]),
    )
    const cf = await inspectModpack(cfFile)
    check(cf.type === 'curseforge', `CF 类型识别错误：${cf.type}`)
    check(cf.mcVersion === '1.19.2' && cf.components.forge === '43.2.0', 'CF manifest 解析错误')
    console.log('      识别通过：modrinth / hmcl / mmc / mcbbs / curseforge')
  })

  // ---------------------------------------------------------------- 10. 完整安装
  await test('完整 InstallTask：自定义实例名 + 隔离 + 清单', async () => {
    const root = path.join(baseDir, 'full-install')
    const manifest = await fetchVersionManifest(MODE)
    const version = manifest.versions.find((item) => item.id === '1.8.9')
    check(version, '版本清单里找不到 1.8.9')
    const startedAt = Date.now()
    let lastReport = 0
    const task = new InstallTask(
      {
        kind: 'version',
        versionId: '1.8.9',
        versionUrl: version!.url,
        versionSha1: version!.sha1,
        root,
        instanceName: 'My 1.8.9',
        mode: MODE,
        concurrency: 24,
        verifyHashes: true,
        manifestSource: manifest.source,
        isolation: true,
      },
      {
        emitSnapshot: (snapshot) => {
          if (Date.now() - lastReport < 5000) return
          lastReport = Date.now()
          const percent = snapshot.totalBytes
            ? ((snapshot.doneBytes / snapshot.totalBytes) * 100).toFixed(1)
            : '0.0'
          console.log(
            `      进度 ${percent}% ${(snapshot.doneBytes / 1024 / 1024).toFixed(1)}/${(
              snapshot.totalBytes /
              1024 /
              1024
            ).toFixed(1)}MB ${snapshot.state}`,
          )
        },
        emitLog: (line) => {
          if (line.level === 'warn' || line.level === 'error') console.log(`      [${line.level}] ${line.text}`)
        },
      },
    )
    await task.start()
    console.log(`      用时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
    const snapshot = task.getSnapshot()
    check(snapshot.state === 'finished', `安装状态 ${snapshot.state}，失败 ${snapshot.failures.length}`)
    if (snapshot.failures.length) console.log(`      失败示例：${snapshot.failures[0].path} ${snapshot.failures[0].error}`)

    const instanceJson = path.join(root, 'versions', 'My 1.8.9', 'My 1.8.9.json')
    check(fs.existsSync(instanceJson), '实例 JSON 未生成')
    const profile = JSON.parse(fs.readFileSync(instanceJson, 'utf8')) as {
      id?: string
      inheritsFrom?: string
      libraries?: unknown[]
    }
    check(profile.id === 'My 1.8.9', `实例 JSON id 错误：${String(profile.id)}`)
    check(!profile.inheritsFrom, '实例 JSON 不应包含 inheritsFrom')
    check((profile.libraries?.length ?? 0) > 0, '实例 JSON 应包含完整内联的 libraries')
    check(fs.existsSync(path.join(root, 'versions', 'My 1.8.9', 'My 1.8.9.jar')), '实例 jar 未复制')
    // 新版流程：原版文件只在安装工作区里流转，不再在 versions/ 留下「原版基座」目录
    check(
      !fs.existsSync(path.join(root, 'versions', '1.8.9')),
      '不应在原版基座目录 versions/1.8.9 留下文件',
    )
    // libraries 仍然共享在游戏根目录
    check(fs.existsSync(path.join(root, 'libraries')), 'libraries 目录缺失')
    const dataDir = dataDirOf(root, 'My 1.8.9', true)
    check(fs.existsSync(path.join(dataDir, 'mods')), `隔离目录没有 mods：${dataDir}`)
    check(!fs.existsSync(path.join(root, 'versions', 'My 1.8.9', '.pclignore')), '.pclignore 未清理')
    const installManifest = await readManifest(root, 'My 1.8.9')
    check(installManifest, '安装清单未生成')
    check(installManifest!.complete, '安装清单标记为不完整')
    check(installManifest!.mcVersion === '1.8.9', '安装清单 mcVersion 错误')
    const listed = await listInstances(root)
    const instance = listed.find((item) => item.name === 'My 1.8.9')
    check(instance, 'listInstances 没有返回刚安装的实例')
    check(instance!.managed === true, 'listInstances managed 标记错误')
    check(instance!.path === dataDir, `listInstances path 错误：${instance!.path}`)
    check(instance!.isolation === true, 'listInstances isolation 标记错误')
    check(instance!.complete === true, 'listInstances complete 标记错误')
    check((instance!.fileCount ?? 0) > 0, 'listInstances fileCount 缺失')
    console.log(`      文件=${snapshot.doneFiles} 体积=${(snapshot.totalBytes / 1024 / 1024).toFixed(1)}MB`)
  })

  await test('取消 / 失败后清理 .pclignore，允许立即重装', async () => {
    const manifest = await fetchVersionManifest(MODE)
    const version = manifest.versions.find((item) => item.id === '1.5.2')
    check(version, '版本清单里找不到 1.5.2')
    const root = path.join(baseDir, 'marker')
    await fsp.rm(root, { recursive: true, force: true })
    const request: InstallRequest = {
      kind: 'version',
      versionId: version!.id,
      versionUrl: version!.url,
      versionSha1: version!.sha1,
      root,
      instanceName: '1.5.2',
      mode: MODE,
      concurrency: 8,
      verifyHashes: true,
      manifestSource: 'mojang',
      isolation: true,
    }
    const marker = path.join(root, 'versions', '1.5.2', '.pclignore')
    const markerExists = async (): Promise<boolean> =>
      fsp.stat(marker).then(() => true).catch(() => false)
    const hooks = { emitSnapshot: (): void => undefined, emitLog: (): void => undefined }

    // A. 取消：标记必须被清理
    const cancelTask = new InstallTask(request, hooks)
    void cancelTask.start()
    const cancelDeadline = Date.now() + 60_000
    while (Date.now() < cancelDeadline && !(await markerExists())) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    check(await markerExists(), '安装开始后没有写出 .pclignore')
    await cancelTask.cancelAndWait()
    check(cancelTask.getSnapshot().state === 'canceled', '取消后状态不是 canceled')
    check(!(await markerExists()), '取消后 .pclignore 未清理')

    // B. 中途失败：标记同样必须被清理
    const badTask = new InstallTask({ ...request, components: { forge: '0.0.0' } }, hooks)
    await badTask.start()
    check(badTask.getSnapshot().state === 'failed', '坏加载器版本没有按预期失败')
    check(!(await markerExists()), '失败后 .pclignore 未清理')

    // C. 取消 / 失败之后立即重装应当成功，而不是被「正在安装中」挡住
    const retryTask = new InstallTask(request, hooks)
    await retryTask.start()
    const retried = retryTask.getSnapshot()
    check(retried.state === 'finished', `重装没有成功：${retried.state} ${retried.failures[0]?.error ?? ''}`)
    await fsp.rm(root, { recursive: true, force: true })
  })

  console.log('')
  if (failed) {
    console.log(`❌ ${failed} 个测试失败，${passed} 个通过`)
    for (const failure of failures) console.log(`\n--- ${failure.name} ---\n${failure.error}`)
    process.exitCode = 1
  } else {
    console.log(`✅ 全部 ${passed} 个测试通过`)
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})

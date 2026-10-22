/**
 * 详细配置页的规则测试（纯函数，不依赖 Electron / 网络）：
 *   yarn test:ui
 *
 * 覆盖 PCL 的互斥规则：Forge / NeoForge / Fabric / Quilt 互斥，
 * OptiFine 在 1.13~1.14.3 与 Forge 不兼容、1.20.5+ 与 Fabric 不兼容，
 * LiteLoader 只在 1.12.2 及以下出现，Fabric API / OptiFabric 自动项可见性与默认实例名。
 */
import type { InstallComponents, LoaderVersionList } from '../src/shared/types'
import {
  buildConfigHints,
  buildConfigRows,
  compareMcVersion,
  defaultInstanceName,
  isLoaderVisible,
  needsManualOptiFabric,
  type ConfigContext,
} from '../src/renderer/lib/install-config'

let passed = 0
let failed = 0

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function test(name: string, fn: () => void): void {
  try {
    fn()
    passed += 1
    console.log(`  [ok] ${name}`)
  } catch (error) {
    failed += 1
    console.error(`  [FAIL] ${name}`)
    console.error(`         ${error instanceof Error ? error.message : String(error)}`)
  }
}

function makeList(id: LoaderVersionList['id'], version: string): LoaderVersionList {
  return {
    id,
    label: id,
    versions: [{ version, label: version }],
    source: 'test',
  }
}

function ctx(
  mcVersion: string,
  components: InstallComponents = {},
  extra: Partial<ConfigContext> = {},
): ConfigContext {
  return {
    mcVersion,
    type: 'release',
    releaseTime: '2024-01-01T00:00:00+00:00',
    components,
    lists: {
      forge: makeList('forge', '47.2.0'),
      neoforge: makeList('neoforge', '20.4.1'),
      fabric: makeList('fabric', '0.20.1'),
      quilt: makeList('quilt', '0.24.0'),
      optifine: makeList('optifine', 'HD_U_I6'),
      liteloader: makeList('liteloader', '1.12.2'),
    },
    javaReport: { found: 1, versions: [{ version: '21', major: 21, path: 'C:/java' }], note: '' },
    ...extra,
  }
}

function row(ctxValue: ConfigContext, id: string) {
  return buildConfigRows(ctxValue).find((item) => item.id === id)
}

console.log('详细配置页规则：')

test('版本比较支持 1.x / 26.x / 快照', () => {
  check(compareMcVersion('1.20.4', '1.20.5') < 0, '1.20.4 应小于 1.20.5')
  check(compareMcVersion('26.3', '1.20.5') > 0, '26.3 应大于 1.20.5')
  check(compareMcVersion('1.20.5-pre1', '1.20.5') === 0, '预发布版应视为同一版本')
})

test('组件可见性随 Minecraft 版本变化', () => {
  const modern = ctx('26.3')
  check(isLoaderVisible('forge', modern), '正式版应显示 Forge')
  check(isLoaderVisible('neoforge', modern), '1.20.1+ 应显示 NeoForge')
  check(isLoaderVisible('fabric', modern), '1.14+ 应显示 Fabric')
  check(!isLoaderVisible('liteloader', modern), '1.13+ 不应显示 LiteLoader')
  check(!isLoaderVisible('fabricApi', modern), '未选 Fabric 时不应显示 Fabric API')

  const old = ctx('1.12.2')
  check(isLoaderVisible('liteloader', old), '1.12.2 应显示 LiteLoader')
  check(!isLoaderVisible('fabric', old), '1.12.2 不应显示 Fabric')

  const legacy = ctx('1.13')
  check(!isLoaderVisible('fabric', legacy), '1.13 不应显示 Fabric')
  check(!isLoaderVisible('liteloader', legacy), '1.13 不应显示 LiteLoader')

  const early = ctx('1.20.1', {}, { releaseTime: '2023-06-01T00:00:00+00:00' })
  check(!isLoaderVisible('neoforge', early), '1.20.1 发布前不应显示 NeoForge')
})

test('选择 Fabric 后 Forge / NeoForge / OptiFine(1.20.5+) 均不兼容', () => {
  const value = ctx('1.20.6', { fabric: '0.20.1' })
  const rows = buildConfigRows(value)
  check(row(value, 'forge')?.error === '与 Fabric 不兼容', 'Forge 应提示与 Fabric 不兼容')
  check(row(value, 'neoforge')?.error === '与 Fabric 不兼容', 'NeoForge 应提示与 Fabric 不兼容')
  check(row(value, 'optifine')?.error === '与 Fabric 不兼容', '1.20.5+ OptiFine 应提示与 Fabric 不兼容')
  check(row(value, 'quilt')?.error === '与 Fabric 不兼容', 'Quilt 应提示与 Fabric 不兼容')
  check(!row(value, 'fabric')?.error, 'Fabric 自身应可用')
  check(row(value, 'fabric')?.version === '0.20.1', 'Fabric 应显示已选版本')
  check(row(value, 'fabricApi')?.visible === true, '选中 Fabric 后应出现 Fabric API')
  check(rows.every((item) => item.visible), '不兼容行应该保留并显示原因，而不是直接隐藏')
})

test('选择 Forge 后 Fabric / NeoForge 不兼容', () => {
  const value = ctx('1.12.2', { forge: '14.23.5.2860' })
  check(row(value, 'fabric') === undefined, '1.12.2 不显示 Fabric')
  const modern = ctx('1.20.1', { forge: '47.2.0' })
  check(row(modern, 'fabric')?.error === '与 Forge 不兼容', 'Fabric 应提示与 Forge 不兼容')
  check(row(modern, 'neoforge')?.error === '与 Forge 不兼容', 'NeoForge 应提示与 Forge 不兼容')
})

test('OptiFine 与 Forge 在 1.13~1.14.3 互斥', () => {
  const value = ctx('1.13.2', { forge: '6.0.0', optifine: 'HD_U_G5' })
  check(row(value, 'forge')?.error === '与 OptiFine 不兼容', 'Forge 应提示与 OptiFine 不兼容')
  check(row(value, 'optifine')?.error === '与 Forge 不兼容', 'OptiFine 应提示与 Forge 不兼容')
  const ok = ctx('1.16.5', { forge: '36.2.34', optifine: 'HD_U_G8' })
  check(!row(ok, 'forge')?.error, '1.16.5 Forge 不应报 OptiFine 不兼容')
  check(!row(ok, 'optifine')?.error, '1.16.5 OptiFine 不应报 Forge 不兼容')
})

test('Fabric + OptiFine 自动项与 1.14~1.15 手动提示', () => {
  const value = ctx('1.20.1', { fabric: '0.20.1', optifine: 'HD_U_I6' })
  check(row(value, 'optifabric')?.visible === true, 'Fabric + OptiFine 应出现 OptiFabric')
  check(needsManualOptiFabric('1.14.4'), '1.14.4 应需要手动处理 OptiFabric')
  check(needsManualOptiFabric('1.15.2'), '1.15.2 应需要手动处理 OptiFabric')
  check(!needsManualOptiFabric('1.20.1'), '1.20.1 不需要手动处理 OptiFabric')
  const noApi = buildConfigHints(ctx('1.20.1', { fabric: '0.20.1', optifine: 'HD_U_I6' }))
  check(
    noApi.some((item) => item.text.includes('Fabric API')),
    '未装 Fabric API 时应提示',
  )
  check(
    noApi.some((item) => item.text.includes('OptiFabric')),
    '未装 OptiFabric 时应提示',
  )
})

test('缺失 Java 时阻止需要 Java 的加载器', () => {
  const bare = ctx('1.20.1', { forge: '47.2.0' }, {
    lists: { forge: { ...makeList('forge', '47.2.0'), requiresJava: true } },
    javaReport: { found: 0, versions: [], note: '未检测到 Java' },
  })
  check(row(bare, 'forge')?.error === '未检测到 Java', '缺少 Java 时 Forge 应不可选')
  check(row(bare, 'forge')?.requiresJava === true, 'Forge 应标记需要 Java')
})

test('版本列表 404 视为该加载器不支持', () => {
  const value = ctx('26.3', {}, {
    lists: { quilt: { error: 'HTTP 404 Not Found - https://meta.quiltmc.org' } },
  })
  check(row(value, 'quilt')?.error === '无', '404 应显示为「无」')
})

test('默认实例名与 PCL 的命名规则一致', () => {
  check(
    defaultInstanceName('26.3', { fabric: '0.20.1' }) === '26.3-Fabric 0.20.1',
    'Fabric 默认名错误',
  )
  check(
    defaultInstanceName('1.20.1', {
      fabric: '0.15.11+1.20.1',
      fabricApi: true,
      optifine: 'HD_U_I6',
      optifabric: true,
    }) === '1.20.1-Fabric 0.15.11-OptiFine_HD_U_I6',
    'Fabric + OptiFine 默认名错误',
  )
  check(
    defaultInstanceName('1.12.2', {
      forge: '14.23.5.2860',
      liteloader: '1.12.2',
      optifine: 'HD_U_G5',
    }) === '1.12.2-Forge_14.23.5.2860-LiteLoader-OptiFine_HD_U_G5',
    'Forge 组合默认名错误',
  )
})

console.log('')
if (failed) {
  console.error(`✗ ${failed} 个用例失败，${passed} 个通过`)
  process.exitCode = 1
} else {
  console.log(`✓ 全部 ${passed} 个用例通过`)
}

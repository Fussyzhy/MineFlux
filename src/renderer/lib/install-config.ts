import type {
  InstallComponents,
  JavaReport,
  LoaderId,
  LoaderVersionList,
} from '../../shared/types'

/** 下载页 / 详细配置页共用的安装选项状态 */
export interface InstallOptionsState {
  instanceName: string
  isolation: boolean
  components: InstallComponents
}

/** 详细配置页里可以配置的组件（比 LoaderId 多出 Fabric API / OptiFabric 两个自动项） */
export type ConfigLoaderId =
  | 'forge'
  | 'neoforge'
  | 'fabric'
  | 'quilt'
  | 'fabricApi'
  | 'optifine'
  | 'optifabric'
  | 'liteloader'

export type LoaderListState = LoaderVersionList | 'loading' | { error: string }
export type LoaderLists = Partial<Record<LoaderId, LoaderListState>>

// ------------------------------------------------------------------ 版本比较

function numericParts(version: string): number[] {
  const parts: number[] = []
  for (const token of version.split(/[.\-_+ ]+/)) {
    const match = /^(\d+)/.exec(token)
    if (match) parts.push(Number(match[1]))
  }
  return parts
}

/**
 * 比较两个 Minecraft 版本号（同时支持 1.x 与 26.x 这类新版本号、快照 ID），
 * 返回 <0 / 0 / >0。
 */
export function compareMcVersion(a: string, b: string): number {
  const pa = numericParts(a)
  const pb = numericParts(b)
  const length = Math.max(pa.length, pb.length)
  for (let index = 0; index < length; index += 1) {
    const left = pa[index] ?? 0
    const right = pb[index] ?? 0
    if (left !== right) return left - right
  }
  return 0
}

export function mcAtLeast(version: string, target: string): boolean {
  return compareMcVersion(version, target) >= 0
}

export function mcAtMost(version: string, target: string): boolean {
  return compareMcVersion(version, target) <= 0
}

function inVersionRange(version: string, from: string, to: string): boolean {
  return mcAtLeast(version, from) && mcAtMost(version, to)
}

/** 加载器只能自动安装到「正式版 / 快照」型号（对应 PCL 的 IsStandardFormat） */
export function isStandardVersion(type: string): boolean {
  return type === 'release' || type === 'snapshot'
}

/** NeoForge 从 1.20.1（2023-06-11 发布）开始才有 */
const NEOFORGE_MIN_RELEASE = Date.UTC(2023, 5, 11)

// ------------------------------------------------------------------ 组件可见性

export interface ConfigContext {
  mcVersion: string
  type: string
  releaseTime?: string
  components: InstallComponents
  lists: LoaderLists
  javaReport: JavaReport | null
}

/** 某个组件行是否应该出现在详细配置页里 */
export function isLoaderVisible(id: ConfigLoaderId, ctx: ConfigContext): boolean {
  switch (id) {
    case 'forge':
      return isStandardVersion(ctx.type)
    case 'neoforge':
      return ctx.releaseTime ? Date.parse(ctx.releaseTime) >= NEOFORGE_MIN_RELEASE : false
    case 'fabric':
    case 'quilt':
      return mcAtLeast(ctx.mcVersion, '1.14')
    case 'liteloader':
      return !mcAtLeast(ctx.mcVersion, '1.13')
    case 'fabricApi':
      return Boolean(ctx.components.fabric || ctx.components.quilt)
    case 'optifabric':
      return Boolean(ctx.components.fabric && ctx.components.optifine)
    case 'optifine':
      return true
    default:
      return false
  }
}

// ------------------------------------------------------------------ 加载器可用性

interface Availability {
  loading: boolean
  error: string | null
  requiresJava: boolean
}

function availability(id: LoaderId, ctx: ConfigContext): Availability {
  const state = ctx.lists[id]
  if (state === undefined || state === 'loading') {
    return { loading: true, error: null, requiresJava: false }
  }
  if ('error' in state) {
    // 该加载器明确不支持这个游戏版本时，接口通常返回 404，按 PCL 的说法就是「无」
    const unsupported = /HTTP 404|404 Not Found/i.test(state.error)
    return { loading: false, error: unsupported ? '无' : '版本列表获取失败', requiresJava: false }
  }
  const requiresJava = Boolean(state.requiresJava)
  if (!state.versions.length) return { loading: false, error: '无', requiresJava }
  if (requiresJava && ctx.javaReport && ctx.javaReport.found === 0) {
    return { loading: false, error: '未检测到 Java', requiresJava }
  }
  return { loading: false, error: null, requiresJava }
}

// ------------------------------------------------------------------ 组件行

export interface ConfigRow {
  id: ConfigLoaderId
  title: string
  visible: boolean
  /** 版本列表还在加载：此时不可展开，避免选到空版本 */
  loading: boolean
  /** 不兼容 / 无可用版本 / 缺 Java 等；有值时该行不可选 */
  error: string | null
  /** 已选中的加载器版本；Fabric API / OptiFabric 这类自动项没有版本号 */
  version?: string
  /** 自动项：安装时自动解析最新兼容版本 */
  auto?: boolean
  /** 选中后需要 Java 才能安装 */
  requiresJava?: boolean
}

/**
 * 按 PCL 的 `LoadXxxGetError` 逻辑计算每个组件行的状态。
 * 行顺序与 PCL 一致：Forge / NeoForge / Fabric / Fabric API / OptiFine / OptiFabric / LiteLoader。
 */
export function buildConfigRows(ctx: ConfigContext): ConfigRow[] {
  const c = ctx.components
  const rows: ConfigRow[] = []

  // Forge
  {
    const visible = isLoaderVisible('forge', ctx)
    let loading = false
    let error: string | null = null
    let requiresJava = false
    if (visible) {
      if (c.neoforge) error = '与 NeoForge 不兼容'
      else if (c.fabric) error = '与 Fabric 不兼容'
      else if (c.quilt) error = '与 Quilt 不兼容'
      else if (c.optifine && inVersionRange(ctx.mcVersion, '1.13', '1.14.3')) {
        error = '与 OptiFine 不兼容'
      } else {
        const state = availability('forge', ctx)
        loading = state.loading
        error = state.error
        requiresJava = state.requiresJava
      }
    }
    rows.push({ id: 'forge', title: 'Forge', visible, loading, error, version: c.forge, requiresJava })
  }

  // NeoForge
  {
    const visible = isLoaderVisible('neoforge', ctx)
    let loading = false
    let error: string | null = null
    let requiresJava = false
    if (visible) {
      if (c.optifine) error = '与 OptiFine 不兼容'
      else if (c.forge) error = '与 Forge 不兼容'
      else if (c.fabric) error = '与 Fabric 不兼容'
      else if (c.quilt) error = '与 Quilt 不兼容'
      else {
        const state = availability('neoforge', ctx)
        loading = state.loading
        error = state.error
        requiresJava = state.requiresJava
      }
    }
    rows.push({
      id: 'neoforge',
      title: 'NeoForge',
      visible,
      loading,
      error,
      version: c.neoforge,
      requiresJava,
    })
  }

  // Fabric
  {
    const visible = isLoaderVisible('fabric', ctx)
    let loading = false
    let error: string | null = null
    if (visible) {
      if (c.quilt) error = '与 Quilt 不兼容'
      else if (c.forge) error = '与 Forge 不兼容'
      else if (c.neoforge) error = '与 NeoForge 不兼容'
      else if (c.optifine && mcAtLeast(ctx.mcVersion, '1.20.5')) {
        error = '与 OptiFine 不兼容'
      } else {
        const state = availability('fabric', ctx)
        loading = state.loading
        error = state.error
      }
    }
    rows.push({ id: 'fabric', title: 'Fabric', visible, loading, error, version: c.fabric })
  }

  // Quilt（PCL 本体没有这一项，是本工具额外支持的模组加载器）
  {
    const visible = isLoaderVisible('quilt', ctx)
    let loading = false
    let error: string | null = null
    if (visible) {
      if (c.fabric) error = '与 Fabric 不兼容'
      else if (c.forge) error = '与 Forge 不兼容'
      else if (c.neoforge) error = '与 NeoForge 不兼容'
      else if (c.optifine) error = '与 OptiFine 不兼容'
      else {
        const state = availability('quilt', ctx)
        loading = state.loading
        error = state.error
      }
    }
    rows.push({ id: 'quilt', title: 'Quilt', visible, loading, error, version: c.quilt })
  }

  // Fabric API（Fabric / Quilt 下自动安装最新兼容版）
  rows.push({
    id: 'fabricApi',
    title: 'Fabric API',
    visible: isLoaderVisible('fabricApi', ctx),
    loading: false,
    error: null,
    auto: true,
  })

  // OptiFine
  {
    let loading = false
    let error: string | null = null
    let requiresJava = false
    if (c.neoforge) error = '与 NeoForge 不兼容'
    else if (c.quilt) error = '与 Quilt 不兼容'
    else if (c.forge && inVersionRange(ctx.mcVersion, '1.13', '1.14.3')) {
      error = '与 Forge 不兼容'
    } else if (c.fabric && mcAtLeast(ctx.mcVersion, '1.20.5')) {
      error = '与 Fabric 不兼容'
    } else {
      const state = availability('optifine', ctx)
      loading = state.loading
      error = state.error
      requiresJava = state.requiresJava
    }
    rows.push({
      id: 'optifine',
      title: 'OptiFine',
      visible: true,
      loading,
      error,
      version: c.optifine,
      requiresJava,
    })
  }

  // OptiFabric（Fabric + OptiFine 时自动安装）
  rows.push({
    id: 'optifabric',
    title: 'OptiFabric',
    visible: isLoaderVisible('optifabric', ctx),
    loading: false,
    error: null,
    auto: true,
  })

  // LiteLoader（1.13 起官方已停止支持，PCL 也只在旧版本显示）
  {
    const visible = isLoaderVisible('liteloader', ctx)
    let loading = false
    let error: string | null = null
    let requiresJava = false
    if (visible) {
      const state = availability('liteloader', ctx)
      loading = state.loading
      error = state.error
      requiresJava = state.requiresJava
    }
    rows.push({
      id: 'liteloader',
      title: 'LiteLoader',
      visible,
      loading,
      error,
      version: c.liteloader,
      requiresJava,
    })
  }

  return rows.filter((row) => row.visible)
}

// ------------------------------------------------------------------ 默认实例名

/** 生成 PCL 风格的默认实例名，例如 `1.20.1-Fabric 0.15.11-Forge_47.2.0` */
export function defaultInstanceName(mcVersion: string, components: InstallComponents): string {
  let name = mcVersion
  if (components.fabric) name += `-Fabric ${components.fabric.split('+')[0]}`
  if (components.quilt) name += `-Quilt ${components.quilt.split('+')[0]}`
  if (components.forge) name += `-Forge_${components.forge}`
  if (components.neoforge) name += `-NeoForge_${components.neoforge.split('+')[0]}`
  if (components.liteloader) name += '-LiteLoader'
  if (components.optifine) name += `-OptiFine_${components.optifine.replace(/\s+/g, '_')}`
  return name
}

/** 1.14 ~ 1.15 没有可用的 OptiFabric，需要用户手动处理（PCL 同样不自动选择） */
export function needsManualOptiFabric(mcVersion: string): boolean {
  return inVersionRange(mcVersion, '1.14', '1.15.2')
}

// ------------------------------------------------------------------ 自动项提示

export interface ConfigHint {
  tone: 'info' | 'warn'
  text: string
}

/** PCL 详细配置页底部的提示（Fabric API / OptiFabric / OptiFine Mod 兼容性） */
export function buildConfigHints(ctx: ConfigContext): ConfigHint[] {
  const c = ctx.components
  const hints: ConfigHint[] = []
  const fabricLike = Boolean(c.fabric || c.quilt)

  if (fabricLike && !c.fabricApi) {
    hints.push({ tone: 'warn', text: '如果不安装 Fabric API，大多数 Mod 都会无法使用！' })
  }
  if (c.fabric && c.optifine && !c.optifabric) {
    hints.push(
      inVersionRange(ctx.mcVersion, '1.14', '1.15.2')
        ? {
            tone: 'warn',
            text: '1.14 / 1.15 需要手动下载 OptiFabric Origins 放进 mods，否则 OptiFine 会无法使用！',
          }
        : { tone: 'warn', text: '必须安装 OptiFabric 才能正常使用 OptiFine！' },
    )
  }
  if (c.optifine && (c.forge || c.fabric) && mcAtLeast(ctx.mcVersion, '1.16')) {
    hints.push({ tone: 'info', text: 'OptiFine 与一部分 Mod 的兼容性不佳，请谨慎安装。' })
  }
  return hints
}

/**
 * Minecraft version json 里的 rules 判定。
 * 语义与官方规范一致：无 rules 视为允许；有 rules 时默认拒绝，
 * 按顺序匹配并以后一个匹配项的 action 为准。
 */

export type OsName = 'windows' | 'osx' | 'linux'

export interface RuleOs {
  name?: string
  arch?: string
  version?: string
}

export interface Rule {
  action?: 'allow' | 'disallow'
  os?: RuleOs
  features?: Record<string, boolean>
}

export interface RuleContext {
  osName: OsName
  /** 'x86' | 'x86_64' | 'arm64' */
  arch: string
  features: Record<string, boolean>
}

export function detectOs(): OsName {
  switch (process.platform) {
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'osx'
    default:
      return 'linux'
  }
}

export function is64Bit(): boolean {
  return process.arch === 'x64' || process.arch === 'arm64'
}

export function detectRuleContext(): RuleContext {
  const arch = process.arch === 'ia32' ? 'x86' : process.arch === 'arm64' ? 'arm64' : 'x86_64'
  return {
    osName: detectOs(),
    arch,
    features: {
      is_demo_user: false,
      has_custom_resolution: false,
      has_quick_plays_support: false,
      is_quick_play_singleplayer: false,
      is_quick_play_multiplayer: false,
      is_quick_play_realms: false,
    },
  }
}

function matchOs(rule: RuleOs, ctx: RuleContext): boolean {
  if (rule.name && rule.name !== ctx.osName) return false
  if (rule.arch && rule.arch !== ctx.arch) return false
  return true
}

function matchFeatures(features: Record<string, boolean>, ctx: RuleContext): boolean {
  for (const [key, expected] of Object.entries(features)) {
    const actual = ctx.features[key] ?? false
    if (actual !== expected) return false
  }
  return true
}

export function isRuleAllowed(rules: unknown, ctx: RuleContext): boolean {
  if (!Array.isArray(rules) || rules.length === 0) return true
  let allowed = false
  for (const raw of rules) {
    if (!raw || typeof raw !== 'object') continue
    const rule = raw as Rule
    if (rule.os && !matchOs(rule.os, ctx)) continue
    if (rule.features && !matchFeatures(rule.features, ctx)) continue
    allowed = rule.action === 'allow'
  }
  return allowed
}

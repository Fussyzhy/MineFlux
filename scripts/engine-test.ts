/**
 * 下载引擎单测：只下载 1.8.9 的 assets，用于定位卡死/吞吐问题。
 *   npx esbuild scripts/engine-test.ts --bundle --platform=node --format=esm --outfile=.tmp/engine-test.mjs
 *   node .tmp/engine-test.mjs
 */
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DownloadEngine } from '../src/core/downloader'
import { getJsonFromSources, getTextFromSources } from '../src/core/http'
import { fetchVersionManifest } from '../src/core/manifest'
import { metaUrls } from '../src/core/mirror'
import { buildAssetPlan, type AssetIndexJson, type PlannedFile, type RawVersion } from '../src/core/version'

const MODE = 'official' as const
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8)
const root = path.join(os.tmpdir(), 'mcdl-e2e', '1.8.9')

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.stat(file)
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const manifest = await fetchVersionManifest(MODE)
  const version = manifest.versions.find((item) => item.id === '1.8.9')
  if (!version) throw new Error('no version')
  const raw = JSON.parse((await getTextFromSources(metaUrls(version.url, MODE))).data) as RawVersion
  const index = (await getJsonFromSources<AssetIndexJson>(metaUrls(raw.assetIndex!.url!, MODE))).data
  const plan = buildAssetPlan({ root, index, mode: MODE })
  const missing: PlannedFile[] = []
  for (const file of plan.files) {
    if (!(await exists(file.dest))) missing.push(file)
  }
  console.log(`assets total=${plan.files.length} missing=${missing.length} concurrency=${CONCURRENCY}`)

  const started = Date.now()
  let bytes = 0
  const engine = new DownloadEngine({
    concurrency: CONCURRENCY,
    verifyHashes: true,
    log: (level, text) => console.log(`[log:${level}] ${text}`),
    onFileStart: (file) => console.log(`  start ${path.basename(file.dest)} ${file.size}`),
    onBytes: (_file, delta) => {
      bytes += delta
    },
    onFileDone: (file) => console.log(`  done  ${path.basename(file.dest)} ${file.size}`),
    onFileSkip: (file) => console.log(`  skip  ${path.basename(file.dest)}`),
    onFileFail: (file, error) => console.log(`  FAIL  ${path.basename(file.dest)} ${error}`),
  })
  const watchdog = setTimeout(() => {
    console.log('WATCHDOG: aborting')
    engine.abort()
  }, Number(process.env.WATCHDOG_MS ?? 120_000))

  const result = await engine.run(missing)
  clearTimeout(watchdog)
  const elapsed = (Date.now() - started) / 1000
  console.log(
    `finished in ${elapsed.toFixed(1)}s, ${(bytes / 1024 / 1024).toFixed(1)} MB, ${(
      bytes / 1024 / 1024 / elapsed
    ).toFixed(2)} MB/s`,
  )
  console.log(`remaining=${result.remaining.length} failed=${result.failed.length} aborted=${result.aborted}`)
  for (const failure of result.failed.slice(0, 10)) console.log(' failure:', failure.path, failure.error)
  for (const item of result.remaining.slice(0, 10)) console.log(' remaining:', path.basename(item.dest))
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

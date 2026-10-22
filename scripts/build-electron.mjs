import esbuild from 'esbuild'

const watch = process.argv.includes('--watch')

const options = {
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  outdir: 'dist-electron',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
}

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log('[build-electron] watching...')
} else {
  await esbuild.build(options)
  console.log('[build-electron] done')
}

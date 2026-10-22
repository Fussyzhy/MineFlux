import { spawn } from 'node:child_process'
import { createServer } from 'vite'
import esbuild from 'esbuild'

const server = await createServer({ configFile: 'vite.config.mts' })
await server.listen()
const url = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`
console.log(`[dev] renderer: ${url}`)

const ctx = await esbuild.context({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  outdir: 'dist-electron',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  sourcemap: 'inline',
  logLevel: 'info',
})
await ctx.rebuild()
await ctx.watch()

const electronBin = (await import('electron')).default
const env = { ...process.env, VITE_DEV_SERVER_URL: url }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE

const child = spawn(electronBin, ['.'], {
  stdio: 'inherit',
  env,
})

child.on('close', async (code) => {
  await ctx.dispose()
  await server.close()
  process.exit(code ?? 0)
})

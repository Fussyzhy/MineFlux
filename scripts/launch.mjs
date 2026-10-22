/**
 * Electron 启动器。
 * 宿主机环境可能带有 ELECTRON_RUN_AS_NODE（例如在 Electron 应用中运行），
 * 这会让 electron.exe 退化成纯 Node，导致 require('electron') 返回二进制路径。
 * 这里显式剔除该变量，保证以正常 GUI 模式启动。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronBinary = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE

const args = ['.', ...process.argv.slice(2)]
const child = spawn(electronBinary, args, { stdio: 'inherit', env })

child.on('close', (code) => {
  process.exit(code ?? 0)
})

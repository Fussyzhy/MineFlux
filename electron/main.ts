import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { InstallTask } from '../src/core/install'
import { fetchVersionManifest } from '../src/core/manifest'
import { listLoaderVersions } from '../src/core/loaders'
import { listModrinthModVersions } from '../src/core/loaders/resources'
import { detectJava } from '../src/core/java'
import { inspectModpack } from '../src/core/modpack'
import { listInstances, removeInstance } from '../src/core/instance'
import type {
  InstallRequest,
  LoaderId,
  LoaderVersionList,
  LogLine,
  Settings,
  SourceMode,
  TaskEvent,
  TaskSnapshot,
  VersionListResult,
} from '../src/shared/types'

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
const isSmoke = process.argv.includes('--smoke')
const smokeInstallArg = process.argv.find((arg) => arg.startsWith('--smoke-install='))
const smokeInstall = smokeInstallArg ? smokeInstallArg.slice('--smoke-install='.length) : null

let mainWindow: BrowserWindow | null = null
let activeTask: InstallTask | null = null
const manifestCache = new Map<string, { at: number; value: VersionListResult }>()

// ------------------------------------------------------------------ 设置

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

/** 应用图标：开发与打包时都在项目根的 build/icon.png（esbuild 只打包代码，不搬资源） */
function appIconPath(): string | undefined {
  const candidate = path.join(app.getAppPath(), 'build', 'icon.png')
  return fs.existsSync(candidate) ? candidate : undefined
}

function defaultRoot(): string {
  const mc = path.join(app.getPath('appData'), '.minecraft')
  if (fs.existsSync(path.join(mc, 'versions'))) return mc
  return path.join(app.getPath('documents'), 'Minecraft')
}

function defaultSettings(): Settings {
  return {
    root: defaultRoot(),
    mode: 'auto',
    concurrency: 24,
    verifyHashes: true,
    isolation: true,
    curseforgeApiKey: process.env.MINEFLUX_CURSEFORGE_API_KEY ?? '',
  }
}

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Partial<Settings>
    return { ...defaultSettings(), ...raw }
  } catch {
    return defaultSettings()
  }
}

function saveSettings(settings: Settings): void {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8')
  } catch (error) {
    console.error('保存设置失败', error)
  }
}

/** 冒烟测试专用的独立安装目录，避免污染用户目录 */
function smokeRootPath(): string {
  return path.join(app.getPath('temp'), 'mineflux-smoke-ui')
}

// ------------------------------------------------------------------ 窗口

function sendEvent(event: TaskEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mineflux:event', event)
  }
}

function emitSnapshot(snapshot: TaskSnapshot): void {
  sendEvent({ type: 'snapshot', snapshot })
}

function emitLog(line: LogLine): void {
  sendEvent({ type: 'log', taskId: activeTask?.id ?? 'system', line })
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    frame: false,
    show: !isSmoke,
    title: 'MineFlux',
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })
  Menu.setApplicationMenu(null)

  const sendWindowState = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('mineflux:windowState', { maximized: mainWindow.isMaximized() })
  }
  window.on('maximize', sendWindowState)
  window.on('unmaximize', sendWindowState)

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL)
    window.webContents.openDevTools({ mode: 'detach' })
  } else {
    void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  return window
}

// ------------------------------------------------------------------ IPC

function createTask(request: InstallRequest): InstallTask {
  if (activeTask) {
    const snapshot = activeTask.getSnapshot()
    if (snapshot.state === 'running' || snapshot.state === 'paused') {
      throw new Error('已有下载任务在进行中，请先取消或等待完成')
    }
  }
  const task = new InstallTask(request, {
    emitSnapshot: (snapshot) => emitSnapshot(snapshot),
    emitLog: (line) => emitLog(line),
  })
  activeTask = task
  void task.start()
  return task
}

function registerIpc(): void {
  ipcMain.handle('mineflux:getVersions', async (_event, mode: InstallRequest['mode']) => {
    const cached = manifestCache.get(mode)
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value
    const value = await fetchVersionManifest(mode)
    manifestCache.set(mode, { at: Date.now(), value })
    return value
  })

  ipcMain.handle('mineflux:startInstall', async (_event, request: InstallRequest) => {
    const settings = loadSettings()
    const filled: InstallRequest = {
      ...request,
      curseforgeApiKey: request.curseforgeApiKey ?? settings.curseforgeApiKey ?? '',
    }
    // 整合包：需要把包里的 Minecraft 版本补全成带下载地址的版本
    if (filled.kind === 'modpack' && filled.modpack && filled.modpack.type !== 'compress') {
      if (!filled.versionId) throw new Error('整合包没有提供 Minecraft 版本信息')
      const cached = manifestCache.get(filled.mode)
      const list =
        cached && Date.now() - cached.at < 5 * 60 * 1000
          ? cached.value
          : await fetchVersionManifest(filled.mode)
      if (!cached) manifestCache.set(filled.mode, { at: Date.now(), value: list })
      const version = list.versions.find((item) => item.id === filled.versionId)
      if (!version) throw new Error(`版本清单里找不到 ${filled.versionId}`)
      filled.versionUrl = version.url
      filled.versionSha1 = version.sha1
      filled.manifestSource = list.source
      // 整合包声明了加载器时，用整合包的组件覆盖
      filled.components = { ...filled.components, ...filled.modpack.components }
    }
    const task = createTask(filled)
    return { taskId: task.id }
  })

  const requireTask = (): InstallTask => {
    if (!activeTask) throw new Error('当前没有下载任务')
    return activeTask
  }

  ipcMain.handle('mineflux:pause', async () => requireTask().pause())
  ipcMain.handle('mineflux:resume', async () => requireTask().resume())
  ipcMain.handle('mineflux:cancel', async () => requireTask().cancelAndWait())
  ipcMain.handle('mineflux:retryFailed', async () => requireTask().retryFailed())

  ipcMain.handle('mineflux:chooseFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择游戏目录',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: loadSettings().root,
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('mineflux:revealPath', async (_event, target: string) => {
    try {
      const stat = fs.statSync(target)
      if (stat.isDirectory()) await shell.openPath(target)
      else shell.showItemInFolder(target)
    } catch {
      await shell.openPath(path.dirname(target))
    }
  })

  ipcMain.handle('mineflux:openExternal', async (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  })

  ipcMain.handle('mineflux:getSettings', async () => {
    const settings = loadSettings()
    if (isSmoke) return { ...settings, root: smokeRootPath() }
    return settings
  })
  ipcMain.handle('mineflux:saveSettings', async (_event, settings: Settings) => {
    saveSettings(settings)
  })
  ipcMain.handle('mineflux:suggestRoot', async () => defaultRoot())
  ipcMain.handle('mineflux:appVersion', async () => app.getVersion())
  ipcMain.handle('mineflux:getInstalledVersions', async (_event, root: string) => {
    return listInstances(root)
  })
  ipcMain.handle('mineflux:removeInstance', async (_event, root: string, name: string) => {
    await removeInstance(root, name)
  })

  ipcMain.handle('mineflux:windowControl', async (event, action: 'minimize' | 'maximize' | 'close') => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (action === 'minimize') {
      win.minimize()
      return win.isMaximized()
    }
    if (action === 'close') {
      win.close()
      return false
    }
    const willMaximize = !win.isMaximized()
    if (willMaximize) win.maximize()
    else win.unmaximize()
    return willMaximize
  })

  ipcMain.handle('mineflux:chooseModpackFile', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择整合包',
      properties: ['openFile'],
      filters: [
        { name: '整合包', extensions: ['zip', 'mrpack', 'modpack'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('mineflux:inspectModpack', async (_event, file: string) => {
    return inspectModpack(file, (level, text) => emitLog({ time: Date.now(), level, text }))
  })

  ipcMain.handle(
    'mineflux:getLoaderVersions',
    async (_event, id: LoaderId, mcVersion: string, mode: SourceMode): Promise<LoaderVersionList> => {
      return listLoaderVersions(id, { mcVersion, mode })
    },
  )

  ipcMain.handle(
    'mineflux:getModVersions',
    async (
      _event,
      slug: 'fabric-api' | 'optifabric',
      mcVersion: string,
      loaders: string[],
      mode: SourceMode,
    ) => {
      return listModrinthModVersions(slug, mcVersion, loaders, mode)
    },
  )

  ipcMain.handle('mineflux:detectJava', async () => {
    const versions = await detectJava()
    return {
      found: versions.length,
      versions: versions.map((item) => ({
        path: item.path,
        major: item.major,
        version: item.version,
      })),
      note: versions.length
        ? undefined
        : '未检测到 Java：Forge 1.13+ / NeoForge / OptiFine 1.14+ 需要 Java 才能安装',
    }
  })
}

// ------------------------------------------------------------------ 冒烟测试

async function runSmoke(window: BrowserWindow): Promise<void> {
  await new Promise<void>((resolve) => {
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', () => resolve())
    } else {
      resolve()
    }
  })
  await new Promise((resolve) => setTimeout(resolve, 4000))
  // 冒烟时窗口默认隐藏，隐藏窗口不刷新画面；显示但不抢焦点，保证截图是当前帧
  if (!window.isVisible()) window.showInactive()
  await new Promise((resolve) => setTimeout(resolve, 400))

  let installSummary = ''
  if (smokeInstall) {
    const mode: InstallRequest['mode'] = 'auto'
    const list = await fetchVersionManifest(mode)
    const version = list.versions.find((item) => item.id === smokeInstall)
    if (!version) throw new Error(`冒烟测试找不到版本 ${smokeInstall}`)
    const root = smokeRootPath()
    console.log(`[smoke] 开始安装 ${version.id} → ${root}`)
    const task = createTask({
      kind: 'version',
      versionId: version.id,
      versionUrl: version.url,
      versionSha1: version.sha1,
      root,
      instanceName: version.id,
      mode,
      concurrency: 16,
      verifyHashes: true,
      manifestSource: list.source,
      isolation: true,
    })
    const deadline = Date.now() + 12 * 60 * 1000
    while (Date.now() < deadline) {
      const snapshot = task.getSnapshot()
      if (snapshot.state === 'finished' || snapshot.state === 'failed' || snapshot.state === 'canceled') {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    const snapshot = task.getSnapshot()
    installSummary = `state=${snapshot.state} bytes=${snapshot.doneBytes}/${snapshot.totalBytes} files=${snapshot.doneFiles}/${snapshot.totalFiles} failures=${snapshot.failures.length}`
    console.log(`[smoke] 安装结果 ${installSummary}`)
    for (const failure of snapshot.failures.slice(0, 5)) {
      console.log(`[smoke] 失败 ${failure.path}: ${failure.error}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }

  const image = await window.webContents.capturePage()
  const out = path.join(process.cwd(), 'smoke.png')
  fs.writeFileSync(out, image.toPNG())
  const dom = await window.webContents.executeJavaScript(
    'document.body.innerText.slice(0, 1600)',
  )
  fs.writeFileSync(path.join(process.cwd(), 'smoke.txt'), String(dom), 'utf8')
  console.log(`[smoke] screenshot saved: ${out}`)

  // 逐页截图，验证 PCL 式标题栏导航与各页面渲染
  const capture = async (name: string): Promise<void> => {
    // 等两帧再截，避免拿到切换页面前的旧画面
    await window.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
    )
    await new Promise((resolve) => setTimeout(resolve, 240))
    const shot = await window.webContents.capturePage()
    fs.writeFileSync(path.join(process.cwd(), name), shot.toPNG())
    console.log(`[smoke] screenshot saved: ${name}`)
  }
  const clickSelector = async (selector: string): Promise<void> => {
    const clicked = await window.webContents.executeJavaScript(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.click(); return Boolean(el) })()`,
    )
    console.log(`[smoke] click ${selector} -> ${clicked}`)
  }
  const openPage = async (page: string): Promise<void> => {
    await clickSelector(`[data-page="${page}"]`)
    await new Promise((resolve) => setTimeout(resolve, 650))
  }
  const openSub = async (sub: string): Promise<void> => {
    await clickSelector(`[data-sub="${sub}"]`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  try {
    await openPage('download')
    // 详细配置页：选版本 → 打开配置 → 选 Fabric 版本（展示互斥行与自动组件）
    await clickSelector('[data-version-row]')
    await new Promise((resolve) => setTimeout(resolve, 350))
    await clickSelector('[data-install-config]')
    await new Promise((resolve) => setTimeout(resolve, 2600))
    await clickSelector('[data-config-row="fabric"] .config-row-head')
    await new Promise((resolve) => setTimeout(resolve, 500))
    await clickSelector('[data-config-versions="fabric"] .config-version')
    await new Promise((resolve) => setTimeout(resolve, 1800))
    await capture('smoke-config.png')
    await openPage('download')
    await openSub('modpack')
    await capture('smoke-modpack.png')
    await openPage('instances')
    await capture('smoke-instances.png')
    await openPage('tasks')
    await capture('smoke-tasks.png')
    await openPage('settings')
    await capture('smoke-settings.png')
    await openPage('about')
    await capture('smoke-about.png')
  } catch (error) {
    console.error('[smoke] page screenshots failed', error)
  }

  if (installSummary) console.log(`[smoke] ${installSummary}`)
  console.log(`[smoke] text: ${String(dom).replace(/\s+/g, ' ').slice(0, 400)}`)
  app.quit()
}

// ------------------------------------------------------------------ 启动

if (isSmoke) app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.mineflux.downloader')
  registerIpc()
  mainWindow = createWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  if (isSmoke) {
    mainWindow.webContents.on('console-message', (_event, _level, message) => {
      console.log(`[renderer] ${message}`)
    })
    await runSmoke(mainWindow)
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 安装过程中退出应用：先取消任务并等清理完成，避免留下 .pclignore 挡住下次安装
let shuttingDown = false
app.on('before-quit', (event) => {
  if (shuttingDown) return
  const task = activeTask
  if (!task) return
  const state = task.getSnapshot().state
  if (state !== 'running' && state !== 'paused') return
  event.preventDefault()
  shuttingDown = true
  void task.cancelAndWait().finally(() => app.quit())
})





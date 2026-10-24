import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { InstallTask } from '../src/core/install'
import { fetchVersionManifest } from '../src/core/manifest'
import { listLoaderVersions } from '../src/core/loaders'
import { listModrinthModVersions } from '../src/core/loaders/resources'
import {
  detectJava,
  getManualJava,
  isManualJava,
  probeJava,
  resolveJavaExecutable,
  setManualJava,
} from '../src/core/java'
import { inspectModpack } from '../src/core/modpack'
import { listInstances, removeInstance } from '../src/core/instance'
import type {
  InstallRequest,
  JavaProbeResult,
  JavaReport,
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
const smokeJavaArg = process.argv.find((arg) => arg.startsWith('--smoke-java='))
const smokeJava = smokeJavaArg ? smokeJavaArg.slice('--smoke-java='.length) : null

let mainWindow: BrowserWindow | null = null
let activeTask: InstallTask | null = null
const manifestCache = new Map<string, { at: number; value: VersionListResult }>()

// ------------------------------------------------------------------ 设置

/** 冒烟测试用独立的 userData（--user-data-dir），避免改到用户真实设置 */
if (isSmoke && !app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('temp'), 'mineflux-smoke-userdata'))
}

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
    javaPath: '',
    javaPreferManual: true,
  }
}

/** 把设置里的手动 Java 同步给 core/java（安装器选择 Java 时会优先使用它） */
function applyManualJava(settings: Settings): void {
  const path = (settings.javaPath ?? '').trim()
  setManualJava(path ? { path, prefer: settings.javaPreferManual !== false } : null)
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
  applyManualJava(settings)
}

// ------------------------------------------------------------------ Java

/** Java 下载页（给没装 Java 的用户一个明确去处） */
const JAVA_DOWNLOAD_URL = 'https://adoptium.net/temurin/releases/?os=windows&arch=x64&package=jdk'

/** 生成界面用的 Java 报告：包含全部候选，并标记当前生效的那个 */
async function buildJavaReport(): Promise<JavaReport> {
  const all = await detectJava()
  const manual = getManualJava()
  const manualPath = manual?.path ?? ''
  let manualError: string | undefined
  if (manualPath) {
    const file = resolveJavaExecutable(manualPath)
    const probed = file ? await probeJava(file, '手动配置') : null
    if (!probed) manualError = '手动配置的 Java 路径无效或无法运行，请检查路径是否指向 java.exe'
  }
  // 与 core 的 pickJava 保持同一套规则（不带最低版本要求时）
  const manualInfo = all.find((item) => isManualJava(item.path))
  const autoInfo = all.filter((item) => !isManualJava(item.path))
  const selected =
    (manualInfo && (manual?.prefer || !autoInfo.length) ? manualInfo.path : undefined) ??
    (autoInfo.length ? autoInfo[autoInfo.length - 1].path : manualInfo?.path)
  return {
    found: all.length,
    versions: all.map((item) => ({
      path: item.path,
      major: item.major,
      version: item.version,
      source: item.source,
      manual: isManualJava(item.path),
    })),
    manualPath: manualPath || undefined,
    manualError,
    selected,
    note: all.length
      ? undefined
      : '未检测到 Java：Forge 1.13+ / NeoForge / OptiFine 1.14+ 需要 Java 才能安装',
  }
}

/** 校验手动填写的路径：java.exe / JDK 根目录 / bin 目录都可以 */
async function probeJavaSetting(target: string): Promise<JavaProbeResult> {
  const input = (target ?? '').trim()
  if (!input) return { ok: false, error: '请填写 Java 路径' }
  const file = resolveJavaExecutable(input)
  if (!file) {
    return {
      ok: false,
      error: '路径不存在：请填写 java.exe，或 JDK / JRE 的安装目录（例如 C:\\Program Files\\Java\\jdk-21）',
    }
  }
  const info = await probeJava(file, '手动配置')
  if (!info) return { ok: false, error: `无法运行 ${file}，它可能不是有效的 Java 可执行文件` }
  return { ok: true, path: file, major: info.major, version: info.version }
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
    return buildJavaReport()
  })

  ipcMain.handle('mineflux:chooseJavaFile', async () => {
    const manual = getManualJava()
    const current = manual ? resolveJavaExecutable(manual.path) : ''
    const result = await dialog.showOpenDialog({
      title: '选择 java.exe',
      properties: ['openFile'],
      defaultPath: current || process.env.ProgramFiles || undefined,
      filters: process.platform === 'win32'
        ? [
            { name: 'Java 可执行文件', extensions: ['exe'] },
            { name: '全部文件', extensions: ['*'] },
          ]
        : [{ name: '全部文件', extensions: ['*'] }],
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('mineflux:probeJavaPath', async (_event, target: string) => {
    return probeJavaSetting(target)
  })

  ipcMain.handle('mineflux:openJavaDownload', async () => {
    await shell.openExternal(JAVA_DOWNLOAD_URL)
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
  /** 往设置页的 Java 输入框里填路径并触发保存（验证手动配置 Java 的链路） */
  const typeJavaPath = async (value: string): Promise<void> => {
    const typed = await window.webContents.executeJavaScript(
      `(() => {
        const input = document.querySelector('.java-path-field input')
        if (!input) return false
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, ${JSON.stringify(value)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        return true
      })()`,
    )
    console.log(`[smoke] type java path ${value} -> ${typed}`)
    await new Promise((resolve) => setTimeout(resolve, 2500))
  }
  const javaDom = async (): Promise<Record<string, unknown>> => {
    return (await window.webContents.executeJavaScript(
      `(() => ({
        effective: document.querySelector('[data-java-effective]')?.innerText ?? '',
        rows: [...document.querySelectorAll('[data-java-list] .java-item')].map((el) => el.innerText.replace(/\\n/g, ' ')),
        hints: [...document.querySelectorAll('.inline-hint')].map((el) => el.innerText.replace(/\\n/g, ' ')),
      }))()`,
    )) as Record<string, unknown>
  }
  /** 切换「优先使用手动指定的 Java」 */
  const togglePrefer = async (): Promise<void> => {
    const flipped = await window.webContents.executeJavaScript(
      `(() => {
        const input = document.querySelector('.java-prefer input')
        if (!input) return null
        input.click()
        return input.checked
      })()`,
    )
    console.log(`[smoke] toggle prefer -> ${flipped}`)
    await new Promise((resolve) => setTimeout(resolve, 2500))
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
    await openSub('java')
    await capture('smoke-settings-java.png')
    if (smokeJava) {
      // 手动指定一个「真实存在但无法运行」的假 java.exe：校验应失败并给出原因
      await typeJavaPath(smokeJava)
      console.log(`[smoke] java report(bad): ${JSON.stringify(await javaDom())}`)
      await capture('smoke-java-bad.png')
      await typeJavaPath(`${fs.realpathSync(process.env.WINDIR ?? 'C:\\Windows')}\\System32\\choice.exe`)
      await typeJavaPath('')
      console.log(`[smoke] java report(cleared): ${JSON.stringify(await javaDom())}`)
      await capture('smoke-java-cleared.png')
      // 再指定一次 jdk，然后关掉「优先手动」：应回退到自动检测的结果
      await typeJavaPath(smokeJava)
      await togglePrefer()
      console.log(`[smoke] java report(auto): ${JSON.stringify(await javaDom())}`)
      await capture('smoke-java-auto.png')
      await togglePrefer()
      console.log(`[smoke] java report(prefer): ${JSON.stringify(await javaDom())}`)
      await typeJavaPath('')
    }
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
  // 手动配置的 Java 要在任何一次检测 / 安装之前注入
  applyManualJava(loadSettings())
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





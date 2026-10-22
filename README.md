<p align="center">
  <img src="docs/logo.png" width="120" alt="MineFlux" />
</p>

<h1 align="center">MineFlux</h1>

<p align="center">
  <b>独立的 Minecraft 下载 / 安装工具</b><br />
  只做下载与安装，不做启动器
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-0.3.0-3B82F6?style=flat-square" />
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows-0078D6?style=flat-square&logo=windows&logoColor=white" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-22C55E?style=flat-square" />
  <img alt="runtime deps" src="https://img.shields.io/badge/runtime%20deps-2-6B7280?style=flat-square" />
  <img alt="electron" src="https://img.shields.io/badge/Electron-33-47848F?style=flat-square&logo=electron&logoColor=white" />
  <img alt="typescript" src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="react" src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black" />
</p>

<p align="center">
  <b>TypeScript</b> · <b>Electron</b> · <b>React</b> · <b>Vite</b> · <b>esbuild</b>
</p>

MineFlux 是一个**独立的、只做下载与安装**的 Minecraft 客户端安装工具。它从零实现并发下载引擎、镜像源改写、加载器安装与整合包识别，只从官方与公共镜像 CDN 实时拉取文件。

> 第三方非官方工具，与 Mojang / Microsoft 均无关联。
> 只从官方与公共镜像 CDN 实时拉取文件，**不内置、不转存任何游戏资源**，也**不提供启动、登录、正版验证**功能。
>
> 版本更新记录见 [CHANGELOG.md](CHANGELOG.md)。

<p align="center">
  <img src="docs/screenshot.png" width="880" alt="MineFlux 下载页" />
</p>

## 目录

- [界面](#界面)
- [技术栈](#技术栈)
- [功能](#功能)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [安装流程](#安装流程)
- [数据来源](#数据来源)
- [已知限制](#已知限制)
- [合规与免责声明](#合规与免责声明)
- [License](#license)

## 界面

整体是无边框窗口 + 标题栏一级导航 + 每页左侧子导航的三层结构，不是单页堆面板。

视觉上是浅色极简风格：纯白背景、细分隔线排版，不使用卡片 / 阴影 / 渐变，只保留一个蓝色强调色；控件使用轻描边，具体表现在标题栏、侧边导航与各页面中。

- **自定义标题栏**：左侧 Logo，中间一级导航「下载 / 实例管理 / 任务 / 设置 / 关于」，右侧 Java 状态胶囊与最小化 / 最大化 / 关闭按钮。
- **左侧子导航 + 右侧内容**：每个页面左侧是单选列表（下载类型、设置分类、实例列表），右侧为页面标题行 + 可滚动内容区。
- **下载页**：左列版本列表 + 安装目录，右列版本详情与「配置并安装」入口；「整合包」子页支持拖拽与文件解析。
- **详细配置页**：返回箭头 + 实例名输入框，中间是可互斥的组件列表（Forge / NeoForge / Fabric / Quilt / Fabric API / OptiFine / OptiFabric / LiteLoader），选中项显示版本号并可清除或展开版本列表；不兼容的组件行会变灰并给出原因（如「与 Fabric 不兼容」），Fabric API / OptiFabric 会自动跟随安装，底部为「开始下载」。
- **任务页**：完整进度、分阶段进度、失败重试与运行日志。
- **实例管理页**：左侧实例列表，右侧概览（MC 版本 / 加载器 / 安装时间 / 文件数 / 隔离 / 清单状态）与操作（打开目录、校验补全、删除）。
- **设置页**：下载源、并发与校验、安装目录、CurseForge API Key、Java 检测。
- **关于页**：功能边界、数据来源与许可说明。

| 详细配置 | 实例管理 | 设置 |
|---|---|---|
| ![详细配置](docs/screenshot-config.png) | ![实例管理](docs/screenshot-instances.png) | ![设置](docs/screenshot-settings.png) |

## 技术栈

<p>
  <img alt="typescript" src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="electron" src="https://img.shields.io/badge/Electron-33-47848F?style=flat-square&logo=electron&logoColor=white" />
  <img alt="react" src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black" />
  <img alt="vite" src="https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite&logoColor=white" />
  <img alt="esbuild" src="https://img.shields.io/badge/esbuild-0.24-FFCF00?style=flat-square&logo=esbuild&logoColor=black" />
  <img alt="node" src="https://img.shields.io/badge/Node.js-%E2%89%A520-339933?style=flat-square&logo=nodedotjs&logoColor=white" />
</p>

| 层 | 选型 | 说明 |
|---|---|---|
| 语言 | **TypeScript 5.7**（`strict`，双 tsconfig） | 主进程与渲染进程共用 `src/shared/types.ts` 的类型契约 |
| 桌面壳 | **Electron 33** | 无边框窗口 + 自绘标题栏；`contextBridge` 暴露 `window.mineflux` |
| 界面 | **React 18**（函数组件 + Hooks） | 不引入 UI 框架，样式全部手写 CSS |
| 构建 | **Vite 5**（渲染进程） + **esbuild**（主进程 / 测试脚本） | 主进程打包为单文件 CJS，渲染产物 200 KB 级 |
| 打包 | **electron-builder 26**（NSIS 安装包 + portable 单文件） | 只打包 `dist/`、`dist-electron/` 与图标，不携带 `node_modules` |
| 测试 | 自研 CLI 脚本（esbuild 打包后直接运行） | 下载核心 e2e、功能验证、UI 规则测试三套，不依赖测试框架 |
| 运行时依赖 | **仅 `react` + `react-dom`** | HTTP、ZIP、maven 路径、SHA1 校验全部手写 |
| 质量门 | `tsc --noEmit`（node + web 双项目） | 当前无 eslint / prettier 依赖 |
| 目标平台 | **Windows**（主要验证） | 路径长度、文件锁、保留名等按 Windows 语义处理 |

`src/core` 不依赖 Electron，可以脱离界面单独运行，因此下载引擎与整合包逻辑都能用脚本直接测：

```text
src/core       纯 Node：清单 / 下载清单 / 并发引擎 / 加载器 / 整合包 / 实例
src/shared     零依赖 IPC 契约（主进程 ↔ 渲染进程）
electron/      主进程 + preload 桥
src/renderer   React 界面（标题栏 + 页面 + 组件）
```

## 功能

### 原版安装

- **版本列表**：Mojang 官方清单 + BMCLAPI 镜像，支持按正式版 / 快照 / 远古版筛选与搜索，标记最新版与已安装实例。
- **完整原版下载**：版本 JSON、客户端 jar、`libraries/` 依赖库、资源索引、`assets/objects/` 全部资源、log4j 日志配置。
- **校验与修复**：对目标目录中已存在的文件逐个 SHA1 + 大小校验，只补缺失/损坏的文件。

### 加载器安装

按固定叠加顺序 **Forge/NeoForge → OptiFine → LiteLoader → Fabric/Quilt** 合并版本 JSON：

| 加载器 | 实现方式 | 需要 Java |
|---|---|---|
| Fabric | Fabric Meta API 拉取 profile JSON（`inheritsFrom` 合并） | 否 |
| Quilt | Quilt Meta API 拉取 profile JSON | 否 |
| Forge ≤ 1.12.2（主版本 < 20） | 解包官方 installer：读取 `install_profile.json` 的 `version.json` / `versionInfo`，释放 `maven/` 内置库 | 否 |
| Forge ≥ 1.13（主版本 ≥ 20） | 运行官方 installer `--installClient`，读取生成的版本 JSON | **是** |
| NeoForge | 运行官方 installer（BMCLAPI 版本列表） | **是** |
| OptiFine ≤ 1.13.2 | 免 Java：jar 释放到 `libraries/optifine/...`，构造 launchwrapper + tweaker 的版本 JSON | 否 |
| OptiFine ≥ 1.14 | 运行 OptiFine installer（临时 home 目录 + 复制回 `.minecraft`） | **是** |
| LiteLoader | 免 Java：按 `versions.json` 构造 tweakClass / libraries / `inheritsFrom` | 否 |
| Fabric API / OptiFabric | Modrinth API 按 MC 版本 + 加载器解析后放进 `mods/` | 否 |

Fabric/Quilt 与 OptiFine 同时选择时，会把 OptiFine 当作 Mod 安装（此时需要勾选 OptiFabric）。

### 实例语义

一个 `versions/<实例>/` 目录就是一个实例，是否隔离由安装选项决定：

- 可自定义**实例名称**（自动清洗非法字符与 Windows 保留名）。
- **版本隔离**：开启后 `mods` / `resourcepacks` / `shaderpacks` 放进 `versions/<实例>/`，关闭则放进游戏根目录。
- 实例版本 JSON 会合并全部加载器、移除 `inheritsFrom` / `jar`、改写 `id`，并复制实例 jar。
- 安装过程写安装中标记，安装完成后写 `mineflux-install.json` 安装清单（组件、文件数、体积、完成状态）。
- 同名实例再次安装按「补全 / 修复」语义处理：已存在的文件逐个校验 SHA1，只补缺失或损坏的文件，不会清空 `mods` 与存档。
- **实例管理页**：左侧实例列表，右侧概览与操作，支持「校验 / 补全」与删除实例（只删 `versions/<实例>`）。

### 整合包安装

支持 7 类整合包，可点按钮选择文件，也可以直接**拖拽**到窗口：

| 类型 | 识别标志 | 加载器来源 |
|---|---|---|
| CurseForge | `manifest.json`（无 `addons`） | `minecraft.modLoaders[].id`，文件走 CF API / 镜像 |
| Modrinth | `modrinth.index.json` | `dependencies`（`minecraft` / `fabric-loader` / `forge` / `neoforge` / `quilt-loader`） |
| HMCL | `modpack.json` | `gameVersion`，覆盖文件在 `minecraft/` |
| MultiMC / Prism | `mmc-pack.json` + `instance.cfg` | `components[]`（`net.minecraft` / `net.minecraftforge` / `net.neoforged` / `net.fabricmc.fabric-loader`） |
| MCBBS | `mcbbs.packmeta` / 带 `addons` 的 `manifest.json` | `addons`（game/forge/neoforge/fabric/quilt/liteloader/optifine） |
| 启动器整合包 | 内嵌 `modpack.zip` / `modpack.mrpack` | 递归解析内层包 |
| `.minecraft` 备份 | 找到 `versions/<ver>/<ver>.json` | 直接解压覆盖到游戏目录（同名替换） |

RAR 不支持，会给出明确提示。

![整合包页](docs/screenshot-modpack.png)

### 下载引擎

- 全局并发连接池（默认 24，可调 1–64）
- 大文件（≥ 8 MB）自动分片、多段 Range 并发
- 每个文件多下载源顺序尝试，失败自动切换
- 下载源熔断：某域名连续失败后 60 秒内优先使用其它源
- SHA1 + 大小双校验，损坏文件自动丢弃并改用其它源
- `.part` 临时文件 + Range 断点续传，原子重命名落盘
- 实时进度：总进度、速度、剩余时间、分阶段进度（版本 JSON / 客户端 / 依赖库 / 加载器 / 资源 / Mod）、失败列表
- 可暂停、继续、取消、重试失败文件

### 其他

- **下载源策略**：镜像优先（默认）/ 官方优先 / 仅镜像。自动模式下若发现镜像不可用，会自动切换到官方源。
- **无边框窗口**：自绘标题栏与窗口控制按钮，标题栏可拖动，支持最大化 / 还原 / 最小化 / 关闭。
- **Java 检测**：自动探测 `MINEFLUX_JAVA_HOME` / `JAVA_HOME` / PATH / 常见安装目录 / 官方启动器 runtime，用于判断哪些加载器可以安装。
- **CurseForge API Key**：可在设置里填写，也支持 `MINEFLUX_CURSEFORGE_API_KEY` 环境变量；留空时使用镜像接口。

## 快速开始

**环境要求**：Node.js ≥ 20、Yarn 1（Classic）、Windows（主要验证平台）。

本项目使用 **Yarn 1（Classic）** 管理依赖，锁文件只有 `yarn.lock` 一份（`packageManager` 已固定版本），请勿混用 npm 以免生成第二份锁文件。

```bash
yarn install

# 开发模式（Vite HMR + Electron）
yarn dev

# 生产构建并启动
yarn start

# 仅构建
yarn build

# 类型检查
yarn typecheck

# 打包成 Windows 安装包（NSIS，输出到 release/）
yarn dist:win

# 打包成免安装单文件 exe
yarn dist:portable
```

> 打包使用 **electron-builder**，首次执行会下载对应版本的 Electron 与 NSIS 工具（约 100 MB），之后会走缓存。
> 安装包产物为 `release/MineFlux-Setup-<version>.exe`，免安装版为 `release/MineFlux-<version>-portable.exe`。
> 应用只打包 `dist/`、`dist-electron/` 与 `build/icon.png`，不包含 `node_modules`（依赖已被 Vite / esbuild 打进产物），所以安装包体积主要来自 Electron 本体。

### 冒烟测试（无需人工点击）

```bash
yarn smoke
```

会启动应用（冒烟期间窗口短暂显示但不抢焦点），加载完成后逐页截图到 `smoke.png`（下载 / 原版游戏）、`smoke-config.png`（详细配置）、`smoke-modpack.png`（整合包）、`smoke-instances.png`（实例管理）、`smoke-tasks.png`（任务）、`smoke-settings.png`（设置）、`smoke-about.png`（关于），并把界面文本导出到 `smoke.txt`。

```bash
yarn smoke:install
```

在冒烟测试的基础上，通过真实的 **渲染进程 → IPC → 下载核心** 链路完整安装一个 1.5.2 版本（约 52 MB）到临时目录，结束后再逐页截图并输出统计。仓库里的 `docs/screenshot*.png` 都来自这次运行。

### 下载核心端到端测试（不依赖 Electron）

```bash
# 查看某版本的下载清单与体积
yarn run e2e -- plan 1.8.9

# 真实下载到 %TEMP%/mineflux-e2e/1.8.9
yarn run e2e -- install 1.8.9

# 全量 SHA1 复验
yarn run e2e -- verify 1.8.9

# 暂停 / 继续 / 重复安装跳过 / 取消 的流程测试
yarn run e2e -- stress 1.5.2

# 加载器 / 实例 / 整合包 功能验证（Fabric 合并、旧版 Forge 解包、
# OptiFine 免 Java 安装、LiteLoader、多格式整合包、完整实例安装）
yarn run e2e:features

# 详细配置页的互斥 / 自动组件 / 默认实例名规则（纯函数，无需网络）
yarn run test:ui

# 核心安全 / 完整性单元测试（路径越界、整合包清单穿越、zip-slip，离线）
yarn run test:core
```

可用环境变量：`MINEFLUX_MODE=auto|official|mirror`、`MINEFLUX_CONCURRENCY=24`。

## 项目结构

```
src/
├─ core/                  # 纯 Node 逻辑，不依赖 Electron，可单独测试
│  ├─ manifest.ts         # 版本清单获取与校验
│  ├─ mirror.ts           # 官方地址 → BMCLAPI 镜像改写
│  ├─ rules.ts            # version json 的 rules(os/arch/features) 判定
│  ├─ version-json.ts     # inheritsFrom 合并、实例 JSON 规范化
│  ├─ maven.ts            # maven 坐标 → 仓库相对路径
│  ├─ version.ts          # 解析 version json，生成文件下载清单（含实例路径）
│  ├─ downloader.ts       # 并发下载引擎（分片 / 多源 / 校验 / 熔断）
│  ├─ loaders/            # 各加载器：版本列表 + 产出待合并 profile
│  │  ├─ fabric.ts        # Fabric / Quilt
│  │  ├─ forge.ts         # Forge（新旧安装器格式）/ NeoForge
│  │  ├─ optifine.ts      # OptiFine（免 Java 方法 + 安装器方法）
│  │  ├─ liteloader.ts    # LiteLoader
│  │  ├─ resources.ts     # Modrinth 上的 Fabric API / OptiFabric
│  │  └─ sources.ts       # 各加载器 API / maven 地址与镜像
│  ├─ modpack/            # 整合包识别与安装
│  ├─ instance.ts         # 实例语义：命名、隔离、安装中标记、安装清单
│  ├─ java.ts             # Java 探测与调用
│  ├─ zip.ts              # 极简 ZIP 读写（整合包/安装器解析）
│  ├─ fsutil.ts           # 原子写入、目录合并等
│  ├─ install.ts          # 安装任务编排
│  └─ http.ts             # 多源顺序请求、超时、错误归一化
├─ shared/types.ts        # 主进程 ↔ 渲染进程契约
└─ renderer/              # React UI（标题栏 + 页面）
   ├─ App.tsx             # 外壳：标题栏、页面切换、全局状态
   ├─ pages/              # 下载 / 详细配置 / 实例管理 / 任务 / 设置 / 关于
   ├─ components/         # 标题栏、侧边导航、版本列表、迷你任务、整合包、任务、日志、图标
   └─ lib/                # 格式化、页面枚举、详细配置的互斥 / 自动组件规则
electron/                 # 主进程与 preload（IPC 桥、无边框窗口控制）
scripts/
├─ dev.mjs                # 开发启动器
├─ launch.mjs             # 启动 Electron（会剔除 ELECTRON_RUN_AS_NODE）
├─ build-electron.mjs     # esbuild 打包主进程
├─ e2e.ts                 # 下载核心端到端测试
├─ e2e-features.ts        # 加载器 / 实例 / 整合包功能测试
├─ test-ui.ts             # 详细配置页规则测试
├─ test-core.ts           # 路径越界 / zip-slip / 整合包清单穿越测试
└─ engine-test.ts         # 下载引擎单测
```

## 安装流程

```
版本清单 (version_manifest.json)
  └─ 版本 JSON (versions/<mc>/<mc>.json)
       ├─ downloads.client        → versions/<mc>/<mc>.jar
       ├─ libraries[]             → libraries/<maven 路径>（按 rules 过滤 + natives classifier）
       ├─ assetIndex              → assets/indexes/<id>.json
       │    └─ objects{}          → assets/objects/<hash[0:2]>/<hash>
       └─ logging.client.file     → assets/log_configs/<id>

加载器阶段（按所选组件，逐个 prepare → mergeVersionJson）
  ├─ Forge / NeoForge profile（解包或运行 installer）
  ├─ OptiFine（免 Java 库 / installer）
  ├─ LiteLoader profile
  └─ Fabric / Quilt profile
       ↓
实例版本 JSON (versions/<实例>/<实例>.json，已移除 inheritsFrom / jar，id 改写)
实例 jar       (versions/<实例>/<实例>.jar)
mods/          (Fabric API / OptiFabric / OptiFine-as-Mod / 整合包 mods)
整合包覆盖文件   (overrides → 数据目录)
安装清单        (versions/<实例>/mineflux-install.json)
```

## 数据来源

| 用途 | 官方 | 镜像 |
|---|---|---|
| 版本清单 / 版本 JSON / 客户端 jar | `launchermeta.mojang.com`、`piston-data.mojang.com` | `bmclapi2.bangbang93.com` |
| 依赖库 | `libraries.minecraft.net` | `bmclapi2.bangbang93.com/maven`、`/libraries` |
| 资源文件 | `resources.download.minecraft.net` | `bmclapi2.bangbang93.com/assets` |
| Forge 安装器 / 版本列表 | `maven.minecraftforge.net`、`files.minecraftforge.net` | `bmclapi2.bangbang93.com/maven`、`/forge/minecraft/<mc>` |
| NeoForge | `maven.neoforged.net` | `bmclapi2.bangbang93.com/neoforge/...` |
| Fabric / Quilt | `meta.fabricmc.net/v2`、`meta.quiltmc.org/v3` | `bmclapi2.bangbang93.com/fabric-meta` |
| OptiFine | `optifine.net` | `bmclapi2.bangbang93.com/optifine` |
| LiteLoader | `dl.liteloader.com/versions` | — |
| Modrinth / CurseForge | `api.modrinth.com/v2`、`api.curseforge.com/v1` | `mod.mcimirror.top` |

BMCLAPI 是第三方公益镜像，使用时请遵守其使用规范，不要滥用并发。

## 已知限制

- **需要 Java 的加载器**：Forge 1.13+、NeoForge、OptiFine 1.14+ 必须运行官方 installer，因此需要本机已安装 Java（Java 8 用于旧版 Forge，Java 17/21 用于新版）。没有 Java 时会在日志里给出明确提示，而不是静默失败。Fabric / Quilt / LiteLoader / Forge ≤ 1.12.2 / OptiFine ≤ 1.13.2 都可以免 Java 安装。
- **OptiFine 1.13.2 以下版本的免 Java 安装**依赖 BMCLAPI 镜像提供的 jar；官方 `downloadx` 链接是临时令牌，失败时会自动回退镜像。
- **LiteLoader 1.12.2 的 SNAPSHOT 构建**在官方服务器上已经 404/500，只能安装可用的 release 构建（如 1.7.10_04、1.12.2_04 之外的旧版）；版本列表里能选到但下载会失败并给出错误。
- **CurseForge 整合包**的单个 mod 文件需要 CurseForge API Key（或镜像接口可用）；否则会把失败记录下来，不会中断其它文件的安装。
- 不处理 1.7 之前的 `virtual` / `map_to_resources` 旧版资源布局。
- 不负责解压 natives 与启动参数拼装（这是启动器启动时的工作，本项目不做启动）。
- 不跨进程续传：`.part` 文件只在同一次会话内用于续传，重启应用后会重新校验并重下损坏分片。
- 主要为 Windows 设计并测试；macOS / Linux 未做验证。

## 合规与免责声明

- 本项目**只下载与安装文件**，不启动游戏、不提供账号登录，也不包含任何游戏本体或资源文件。
- 所有文件均实时从 Mojang 官方 CDN 或公开镜像获取，本项目不托管、不分发这些文件。
- 使用本项目即表示你已知悉：下载与使用 Minecraft 需遵守 [Minecraft EULA](https://www.minecraft.net/eula) 及你所在地区的法律法规。
- 请自行确认在你的使用场景下这样做是合规的；本项目不提供任何法律意见，也不对使用后果负责。
- 如果你要分发本工具，请勿使用与 Minecraft 官方混淆的名称与图标。

## License

MIT（仅适用于本仓库自身代码；Minecraft 相关资源版权归 Mojang / Microsoft 所有）

---

<p align="center">
  <img src="docs/logo.png" width="28" alt="MineFlux" />
  <sub>MineFlux · 第三方非官方工具 · 仅下载与安装，不提供启动 / 登录 / 正版验证</sub>
</p>

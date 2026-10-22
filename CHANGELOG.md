# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的格式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.0] - 2026-10-23

**首个公开发布版本。** 这是一个独立的 Minecraft「下载 / 安装」工具：只从官方与公共镜像 CDN 拉取文件，负责安装、校验与修复，**不提供启动、登录、正版验证**功能。

### 新增

#### 界面

- PCL 风格整体框架：无边框窗口 + 自绘标题栏一级导航（下载 / 实例管理 / 任务 / 设置 / 关于），页面内左侧子导航 + 右侧内容区。
- 浅色极简视觉：纯白背景、细分隔线排版，不使用卡片 / 阴影 / 渐变，仅一个蓝色强调色。
- **详细配置页**：返回 + 实例名输入框，组件行列表（Forge / NeoForge / Fabric / Quilt / Fabric API / OptiFine / OptiFabric / LiteLoader）；选中项显示版本、可清除或展开版本列表；互斥组合自动变灰并给出原因（如「与 Fabric 不兼容」「与 OptiFine 不兼容」）。
- 自动组件与 PCL 规则对齐：选择 Fabric 自动带 Fabric API；Fabric + OptiFine 自动带 OptiFabric；1.14~1.15 提示手动处理；清除主组件时联动清除自动项。
- 实例名按所选组件自动生成（如 `26.3-Fabric 0.20.1`），可手动修改。

#### 原版下载与安装

- 版本清单：Mojang 官方 + BMCLAPI 镜像，支持正式版 / 快照 / 远古版筛选与搜索，标记最新版与已安装实例。
- 完整原版下载：版本 JSON、客户端 jar、`libraries/`、资源索引、`assets/objects/`、log4j 日志配置。
- 并发下载引擎：多源顺序尝试、按 host 熔断、失败重试、断点续传、大文件分片下载。
- SHA1 + 大小双重校验；重复安装时按「补全 / 修复」处理，只补缺失或损坏文件。
- 版本隔离：`mods` / `resourcepacks` / `shaderpacks` 跟随实例目录，可关闭。
- 实例安装清单 `mineflux-install.json`，记录 MC 版本、组件、隔离方式、文件数与体积。

#### 加载器安装

| 加载器 | 实现方式 |
|---|---|
| Fabric / Quilt | 官方 Meta API 获取 profile，`inheritsFrom` 合并 |
| Forge ≤ 1.12.2 | 解包官方 installer（无需 Java） |
| Forge ≥ 1.13 | 运行官方 installer（需要 Java） |
| NeoForge | 运行官方 installer（需要 Java） |
| OptiFine ≤ 1.13.2 | 免 Java 安装（释放 jar + 构造 launchwrapper/tweaker profile） |
| OptiFine ≥ 1.14 | 运行 OptiFine installer（需要 Java） |
| LiteLoader | 免 Java，按 `versions.json` 构造 profile |
| Fabric API / OptiFabric | 通过 Modrinth 自动解析最新兼容版本并作为 Mod 安装 |

- 按 PCL 顺序叠加合并：Forge / NeoForge → OptiFine → LiteLoader → Fabric / Quilt。

#### 整合包

- 识别并安装 7 类整合包：CurseForge（manifest.json）、Modrinth（modrinth.index.json）、HMCL、MultiMC / Prism、MCBBS、启动器嵌套包、`.minecraft` 备份压缩包。
- 支持把 `.zip` / `.mrpack` 直接拖到下载页解析安装。
- CurseForge 整合包支持可选 API Key（设置页或 `MINEFLUX_CURSEFORGE_API_KEY` 环境变量），无 Key 时走镜像接口。
- 整合包依赖的 MC 版本与加载器会自动解析并安装，整合包内 mods 与 overrides 一并落盘。

#### 实例管理

- 实例列表自动分类：安装中 / 本工具安装 / 外部实例 / 原版基座；原版基座默认隐藏，可手动显示。
- 实例详情：MC 版本、加载器、安装时间、文件数与体积、隔离方式、安装清单状态。
- 支持打开实例目录、校验 / 补全、删除实例（只删除 `versions/<实例名>`，不影响其它实例与共享 mods）。

#### 任务与日志

- 任务页：总进度、分阶段进度（版本信息 / 客户端 / 依赖库 / 安装器 / 资源索引 / 资源 / 日志配置 / 模组 / 覆盖文件）、实时速度与剩余时间。
- 支持暂停、继续、取消、重试失败文件；取消时清理临时文件但保留已完成分片。
- 运行日志按级别着色并跟随滚动，失败文件可查看具体错误。

#### 设置

- 下载源：自动（镜像优先）/ 官方源优先 / 仅 BMCLAPI 镜像。
- 并发连接数（1–64）、是否校验已存在文件的 SHA1、是否默认开启版本隔离。
- 安装目录选择与推荐路径（`.minecraft` / `Documents\Minecraft`）。
- CurseForge API Key、Java 运行时检测与多版本展示。

### 安全与稳定性

- 整合包清单与 ZIP 解压均校验路径必须落在游戏目录内，阻止 `../` 越界写入（含 zip-slip）。
- 取消、安装失败、关闭应用时都会释放「安装中」标记（`.pclignore`），不会出现同名实例被挡住 2 小时无法重装的情况。
- 暂停后恢复会沿用未完成的下载队列，加载器 / 整合包阶段不会丢文件。
- 任务完成前校验「已登记文件是否全部完成」，避免把半成品标记为安装成功。
- 修复进度读数异常：速度单位不再出现 `undefined`，已下载字节不会超过总量，速度空闲时归零。

### 工程与发布

- Electron 33 + React 18 + Vite 5 + TypeScript 5.7（`strict`），主进程与测试脚本使用 esbuild 打包。
- `electron-builder` 打包：NSIS 安装包（可选安装目录、桌面 / 开始菜单快捷方式）与 portable 免安装单文件；只打包 `dist/`、`dist-electron/` 与图标，不携带 `node_modules`。
- 自动冒烟测试：启动应用后逐页截图（下载 / 详细配置 / 整合包 / 实例管理 / 任务 / 设置 / 关于）并导出界面文本。

### 测试

- `yarn typecheck`：主进程与渲染进程双 tsconfig 类型检查通过。
- `yarn test:ui`：详细配置页互斥 / 自动组件 / 默认实例名规则 9 条用例通过。
- `yarn test:core`：路径越界、整合包清单穿越、zip-slip、进度格式化 6 条用例通过。
- `yarn e2e:features`：加载器 / 实例 / 整合包功能验证 11 项通过（Fabric 合并、旧版 Forge 解包、OptiFine 免 Java、LiteLoader、NeoForge、多格式整合包、完整实例安装、取消/失败后立即重装）。
- `yarn smoke:install`：通过真实 IPC 安装 Minecraft 1.5.2（480 个文件 / 约 52 MB），并输出逐页截图。

### 已知限制

- 需要 Java 的加载器：Forge 1.13+、NeoForge、OptiFine 1.14+ 依赖本机 Java；缺 Java 时会在详细配置页直接禁用对应组件并提示。
- LiteLoader 部分 SNAPSHOT 构建在官方服务器上已 404/500，只能安装可用的 release 构建。
- 暂不支持 RAR 整合包，请先转成 ZIP；不支持 1.7 之前的 `virtual` / `map_to_resources` 旧资源布局。
- 不负责解压 natives 与拼装启动参数（那是启动器的工作），因此不提供启动功能。
- 主要针对 Windows 10/11 x64 验证；macOS / Linux 未验证。
- 安装包暂未做代码签名，首次运行可能触发 SmartScreen 提示。

### 下载

- 安装版：`MineFlux-Setup-<version>.exe`（NSIS，支持自选安装目录）。
- 免安装版：`MineFlux-<version>-portable.exe`。
- 所有游戏文件仍由工具在安装时从官方 / 镜像 CDN 实时下载，发布包不包含任何游戏本体或资源文件。

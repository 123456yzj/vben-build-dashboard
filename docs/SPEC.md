# Ubuntu 测试环境多子包分支管理与构建 GUI 工具需求规格说明书

- **文档状态**：需求定义全部就绪（Complete Spec - v0.6 终版）
- **更新日期**：2026-09-04
- **适用环境**：Ubuntu Server (纯内网免密，支持本机与远程浏览器访问)
- **工程定位**：**独立 Node.js 外部轻量运维工具**（零侵入业务代码，解耦独立部署）
- **核心宗旨**：**极致简化打包与环境运维全流程**（分支管理、产物本地定向传输、实时内存监控与防OOM限额、依赖与缓存深度清理、NVM与pnpm多版本切换）

---

## 1. 背景与核心痛点

在 Ubuntu 测试服务器上进行前端多仓工程打包构建时，存在以下痛点：
1. **路径与分支繁琐**：手动 `cd apps/web-<app>` 切分支拉代码，再返回根目录打包，历史废弃分支清理繁琐。
2. **多包产物流向不一**：各业务包在服务器上的部署静态路径不同（如 admin 对应 `/var/www/admin`，bms 对应 `/var/www/bms`），手工拷贝耗时且易出错。
3. **内存激增与 OOM 风险**：多包打包时 Node 内存瞬时激增，导致系统卡死或触发 OOM Killer 杀掉构建进程，缺乏实时内存监测与硬性限额机制。
4. **依赖与缓存污染**：切分支后容易发生依赖冲突，需要便捷的依赖重装与一键缓存深度清理功能。
5. **Node/pnpm 版本切换**：不同分支需求不同 Node/pnpm 版本，终端手工切换环境变量容易产生混淆。

---

## 2. 最终全量标准化重构提示词（Prompt Template - v0.6 全功能版）

> **说明**：以下提示词已汇集全部功能规格、环境约束与底层技术细节，可直接用于指引完整项目源码生成。

```markdown
# 角色与目标
你是一名资深 DevOps 与全栈工具开发专家。请为部署在 Ubuntu 服务器上的 Monorepo / 多仓前端项目开发一套**完全独立的轻量级 Node.js Web 控制台运维工具**。
该工具的核心宗旨是**极致简化测试环境构建与环境维护全流程**，彻底免除在终端中手工切目录、切分支、退回构建、多目录拷贝产物、处理内存溢出及手动切换 Node/pnpm 版本的繁琐操作。

# 工具架构与运行形态
- **独立工程部署**：作为一个独立的 Node.js 工具项目存放在服务器独立目录（如 `/opt/web-build-dashboard/`），零侵入业务代码库。
- **技术选型**：纯 Node.js 服务端（原生 HTTP / Express + WebSocket/SSE 日志流）+ 现代化免编译单页 Web GUI（开箱即用，运行时内存 < 30MB）。
- **网络访问**：服务默认监听 `0.0.0.0:9527`，纯内网免密直接访问，Ubuntu 本机桌面浏览器与外部开发者电脑浏览器均可直接打开。

# 核心功能模块

## 1. 项目识别与多子包大盘 (Dashboard)
- **目标工程配置**：支持在界面手动指定被管理的 Monorepo 根路径，自动验证 `package.json` 与 `pnpm-workspace.yaml`，支持平滑切换不同工程路径。
- **子仓库状态大盘**：自动扫描 `apps/*` 下的所有子仓库，卡片式实时展示：
  - 当前检出分支名与远端追踪状态。
  - 最新 Commit 信息（Hash、作者、提交内容、提交时间）。
  - 脏工作区标识（Dirty Status，标出是否有未 commit 的临时修改及文件数）。

## 2. Git 分支自动化管理 (Branch Manager)
- **拉取与刷新**：一键全局或单包执行 `git fetch -p` 同步远程最新分支。
- **分支检出 (Checkout)**：
  - 单包检出：下拉框快速筛选并切换本地/远程分支。
  - 多包联动检出：顶部输入特性分支名（如 `feature/xxx`），一键将所有存在该同名分支的子包批量检出，不存在的子包自动跳过并状态提示。
- **脏工作区智能拦截 (Dirty Workspace Handling)**：
  - 检测到当前子包有未提交修改时，点击切分支主动弹出对话框：
    1. 【暂存并切换 (Git Stash & Checkout)】
    2. 【强制丢弃本地改动 (Hard Reset)】
    3. 【取消操作】
- **一键清理失效/历史分支 (Branch Prune)**：
  - 提供【一键清理】按钮：自动清理所有已合并到主分支（master/main/test）的本地历史分支，以及远程已删除的本地残余分支。
  - 提供分支维护抽屉：列表勾选指定分支进行批量删除。
  - 受保护分支白名单（`master`, `main`, `develop`, `test` 等）严格禁止在界面上被删除。

## 3. 打包构建与内存防 OOM 调度台 (Build Pipeline & Anti-OOM)
- **构建目标选择**：支持单选某个业务包单独打包、多选打包或一键【全量打包】。
- **灵活并发策略**：
  - 界面提供【允许并行打包 (Turbo)】开关：开启走 Turbo 原生多核并行构建；关闭走队列串行依次打包（平稳控制系统负载）。
- **实时内存监控**：
  - 界面实时轮询推流 Ubuntu 系统内存占用率（Total / Used / Free）以及构建进程树的实时物理内存（RSS），直观展示内存消耗曲线/仪表盘。
- **构建内存上限限制 (Anti-OOM)**：
  - 支持在界面或设置中配置构建内存上限（如 4096MB、8192MB），启动构建时动态注入环境变量：
    `NODE_OPTIONS="--max-old-space-size=XXXX"`
    彻底防止瞬时内存突增打爆系统 RAM 导致 OOM 崩溃。
- **实时高亮终端**：基于 WebSocket / SSE 实时推流标准输出，内置 ANSI 颜色解码、自动滚屏、清屏与耗时统计。

## 4. 产物管理、本地定向传输与网页下载 (Artifacts Management)
- **默认产物生成**：打包产物默认保留在各应用代码目录（`apps/<app>/dist`）。
- **本地多目录定向传输**：
  - 支持在设置中为每个业务包单独配置服务器本地目标路径（如 `apps/web-admin` -> `/var/www/admin`，`apps/web-bms` -> `/var/www/bms`）。
  - 打包完成后支持一键【传输至目标目录】（覆盖前自动为上一版本在目标目录生成带时间戳的备份快照），亦可开启【打包后自动传输】。
- **网页端一键下载**：各应用卡片提供【下载 Zip】按钮，后端流式压缩产物直传浏览器。

## 5. 依赖包维护与深度缓存清理 (Package & Cache Cleaner)
- **依赖安装与重装**：提供一键 `pnpm install` 与深度重装（清除 lockfile 后全量安装）。
- **缓存深度清理**：
  - 构建缓存清理：一键清理所有子包与根目录的 `.turbo`、`dist` 及 `node_modules/.vite` 缓存。
  - 深度重置：一键彻底清理项目中所有 `node_modules` 目录。

## 6. Node.js (基于 NVM) 与 pnpm 多版本管理 (Runtime Switcher)
- **Node.js 多版本管理**：
  - 对接 Ubuntu 服务器已有的 `nvm` 环境（通过 `~/.nvm/versions/node` 或 `nvm.sh`）：
  - 自动列出已安装的 Node 版本列表，支持界面切换当前项目构建生效的 Node 版本（构建子进程通过动态注入对应 Node bin 目录或 nvm exec 执行）。
  - 支持在界面输入版本号执行 `nvm install <version>` 安装新 Node 版本。
- **pnpm 多版本管理**：
  - 支持查看当前 pnpm 版本，支持一键切换或安装指定 pnpm 版本（通过 `corepack` 或 `npm i -g pnpm@<version>`）。

## 7. 系统配置中心 (Settings Panel)
- 可视化维护以下配置并持久化保存在本地 `config.json`：
  - 目标工程根目录（Monorepo Path）。
  - 各业务子包本地部署目标目录映射表。
  - 构建最大内存上限（Max Old Space Size，默认 8192MB）。
  - 保护分支白名单列表。
  - 当前选定的 Node 与 pnpm 运行版本。
  - 默认构建模式偏好（开发/生产、并行/串行）。
```

---

## 3. 详细技术实现与交互流程

```mermaid
flowchart TD
    subgraph BrowserClient [网页控制台 (0.0.0.0:9527)]
        Cards[业务子包大盘 (分支/Commit/Dirty)]
        MemMonitorUI[实时内存监控仪表盘 (System RAM & RSS)]
        BuildBar[打包调度: 并行开关 / 内存限额 / 实时日志]
        DeployActions[产物区: 网页下载Zip / 本地定向传输]
        CleanActions[环境维护: 重装依赖 / 清理缓存 / 清理node_modules]
        NvmPanel[运行时环境: NVM版本切换 / pnpm切换]
        SettingsModal[配置中心: Repo路径 / 部署路径映射]
    end

    subgraph NodeServer [独立 Node.js 工具后台]
        HttpAndWs[HTTP 路由 & WebSocket/SSE 推流]
        SysMemLoop[内存轮询器 (os & pidusage)]
        GitSubprocess[Git 引擎 (拉取/切换/清理/Stash)]
        BuildSubprocess[构建引擎 (动态注入 NODE_OPTIONS 内存上限)]
        LocalSync[本地目录同步器 (带时间戳备份)]
        ZipStreamer[Archiver 流式压缩]
        NvmBridge[NVM 桥接模块 (读取与切换 Node bin)]
        ConfigManager[(本地 config.json)]
    end

    subgraph ServerEnv [Ubuntu 服务器本地环境]
        NvmDir[~/.nvm/versions/node/ 多版本 Node]
        TargetRepo[目标 Monorepo 目录]
        LocalTargets[本地部署目标目录 (/var/www/...)]
    end

    BrowserClient <==>|操作指令 / 实时推流日志 / 内存数据| HttpAndWs
    HttpAndWs --> ConfigManager
    HttpAndWs --> SysMemLoop
    HttpAndWs --> NvmBridge
    HttpAndWs --> GitSubprocess
    HttpAndWs --> BuildSubprocess
    
    NvmBridge --> NvmDir
    GitSubprocess --> TargetRepo
    BuildSubprocess -->|执行构建 (按指定 Node 与内存限额)| TargetRepo
    TargetRepo -->|打包生成| DistFiles[各包 dist 目录]
    DistFiles -->|ZipStreamer| BrowserClient
    DistFiles -->|LocalSync 本地拷贝与备份| LocalTargets
```

---

## 4. 各模块底层技术执行细节

### 4.1 NVM 与 Node 版本调度策略
- **读取版本**：直接读取 `~/.nvm/versions/node` 目录下的子文件夹，无需每次激活 bash shell，极速列出已安装 Node 版本（如 `v18.20.4`, `v20.18.0`, `v22.11.0`）。
- **执行命令包装**：当用户选择特定 Node 版本时，后端在 spawn 子进程时将 `~/.nvm/versions/node/v<version>/bin` 优先 prepend 到环境变量 `PATH` 前端，实现对指定 Node 版本的毫秒级平滑调用。
- **安装新版本**：调用 `bash -c "source $NVM_DIR/nvm.sh && nvm install <ver>"` 并通过实时终端反馈安装进度。

### 4.2 本地目录定向传输与安全备份机制
- **传输方式**：使用 Node.js 原生 `fs.cp(src, dest, { recursive: true })` 或执行 Linux `rsync -av --delete`。
- **自动备份**：在覆盖前，若目标目录已存在，自动将原目录重命名备份为：
  `/var/www/admin_backup_20260904_101500`
  界面上保留【查看历史备份】与【一键回滚】功能。

### 4.3 内存实时监控与防 OOM 执行细节
- **系统总内存**：通过 Node.js 原生 `os.totalmem()` 与 `os.freemem()` 实时计算。
- **构建进程内存**：利用 Linux 原生 `/proc/[pid]/statm` 或 `pidusage` 获取当前构建子进程及其所有子进程（Turbo、esbuild、vite 等）的 Resident Set Size (RSS) 总和。
- **硬性上限**：启动命令强制添加 `NODE_OPTIONS="--max-old-space-size=${maxMemoryMb}"`。

---

## 5. 需求跟踪与确认清单（全项闭环）

- [x] **Q1: 界面形态与访问方式**：B/S Web 控制台，绑定 `0.0.0.0`，Ubuntu 本机与远程电脑均可浏览器访问。
- [x] **Q2: 产物多流向机制**：支持默认 `dist`、一键 Zip 网页下载、同步至 Nginx 静态目录。
- [x] **Q3: 权限与访问控制**：纯内网环境，免密直接访问。
- [x] **Q4: 多包打包并发策略**：界面提供【允许并行打包】开关，支持 Turbo 并发与队列串行按需切换。
- [x] **Q5: 工作区未提交改动策略**：检测到脏代码时弹窗提供【暂存并切换】、【放弃本地改动】与【取消】。
- [x] **Q6: 工程定位**：独立外部 Node.js 工具工程，完全解耦业务代码库。
- [x] **Q7: 技术实现**：Node.js 原生/轻量服务 + 极简单页 Web GUI。
- [x] **Q8: 产物定向传输目标**：全在 Ubuntu 服务器本地文件系统内拷贝，无需跨机 SSH。
- [x] **Q9: Node 版本管理底座**：对接 Ubuntu 服务器已安装的 `nvm`。

---

## 6. 变更历史与维护记录

| 日期 | 版本 | 修改说明 | 操作人 |
| :--- | :--- | :--- | :--- |
| 2026-09-04 | v0.1.0 | 初始需求讨论整理与标准化提示词编制 | AI Pair |
| 2026-09-04 | v0.2.0 | 确认双端 Web 访问形态、设置中心、产物多流向支持 | AI Pair |
| 2026-09-04 | v0.3.0 | 锁定内网免密、并行开关策略、脏工作区 Stash 弹窗交互及完整流程图 | AI Pair |
| 2026-09-04 | v0.4.0 | 确定独立 Node.js 工具定位，确立“极致简化打包步骤”的核心设计理念 | AI Pair |
| 2026-09-04 | v0.5.0 | 扩充手动设置 Repo、多包产物定向传输、实时内存监控与防OOM限额、依赖清理、版本管理 | AI Pair |
| 2026-09-04 | v0.6.0 | 锁定服务器本地定向传输（无跨机）、锁定 NVM 原生桥接集成，全功能规格终版就绪 | AI Pair |

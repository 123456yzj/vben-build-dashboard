# vben-build-dashboard

面向 Monorepo / 多仓前端项目的轻量分支管理与开发环境打包控制台。

项目采用前后端分离工程架构（参考 `sub2api` 目录规范）：
- **`frontend/`**：TypeScript + Vue 3 + Vite 7 单页面前端应用。
- **`backend/`**：TypeScript + Node.js + Koa 2 + WebSocket + SQLite 后端服务。
- **`deploy/`**：容器化与生产部署脚本及配置（Dockerfile、Docker Compose 等）。

## 目录结构

```
vben-build-dashboard/
├── backend/                  # 后端独立工程
│   ├── src/                  # 后端 TypeScript 源码
│   │   ├── lib/              # 构建、配置、数据库与 Git 模块
│   │   ├── bridge.ts         # Windows 与 WSL 端口转发桥接脚本
│   │   └── server.ts         # Koa 服务入口 (REST API + WebSocket + 静态托管)
│   ├── config.example.json   # 默认配置示例
│   ├── package.json          # 后端依赖配置
│   └── tsconfig.json         # 后端 TypeScript 编译配置
├── frontend/                 # 前端独立工程
│   ├── public/               # 前端静态资源
│   ├── src/                  # Vue 3 前端源码
│   │   ├── components/       # UI 组件库 (控制台、大盘面板、弹窗等)
│   │   ├── App.vue           # 根组件
│   │   ├── main.ts           # 前端入口
│   │   ├── style.css         # 全局样式
│   │   └── useDashboard.ts   # 组合式状态管理与通信
│   ├── index.html            # HTML 模板入口
│   ├── package.json          # 前端依赖配置
│   ├── tsconfig.json         # 前端 TypeScript 检查配置
│   └── vite.config.ts        # Vite 配置 (代理 /api 与 /ws 到后端)
├── deploy/                   # 部署与运维配置
│   ├── docker-compose.yml    # Docker Compose 服务编排
│   ├── Dockerfile            # 多阶段构建 Dockerfile
│   ├── rebuild-docker.sh     # 容器重新构建与热替换脚本
│   ├── setup-portproxy-9527.bat # Windows WSL 端口转发脚本
│   └── start.sh              # 宿主机一键启动脚本
├── docs/                     # 项目设计文档
├── Dockerfile                # 根目录 Dockerfile（方便直接根目录构建）
├── docker-compose.yml        # 根目录 compose 文件
├── package.json              # 根工作区 (npm workspaces 聚合前后端调度)
└── README.md
```

## 核心功能

- **多仓分支大盘**：自动识别 Monorepo 根目录与 `apps/*` 子仓，展示分支、最新提交和工作区状态。
- **Git 自动化**：支持 fetch、单仓/多仓批量切分支、stash 暂存、reset 重置及失效/已合并本地分支清理。
- **打包调度**：支持单应用、多应用及全量开发环境打包，通过 WebSocket 实时输出终端彩色彩字日志。
- **极速响应**：使用 SQLite 缓存仓库状态，避免高耗时的重复物理扫描（毫秒级开屏）。

## 快速开始 (本地开发)

在项目根目录下通过 npm workspaces 一键启动：

需要 Node.js 22.12 或更高版本。

```bash
# 1. 安装根目录及前后端依赖
npm install

# 2. 同时启动后端 (9527) 与前端 Vite 开发服务器 (5173)
npm run dev

# 严格检查前后端 TypeScript
npm run typecheck
```

浏览器访问 `http://localhost:5173`。Vite 会自动将 `/api` 与 `/ws` 请求反向代理至后端 `9527` 端口。

亦可进入各自目录独立启动：
- 前端独立开发：`cd frontend && npm run dev`
- 后端独立开发：`cd backend && npm run dev`

## 生产运行 (宿主机)

```bash
# 编译前后端并启动 Koa 单服务
npm start
```

生产服务监听 `http://0.0.0.0:9527`，本机访问 `http://localhost:9527`。

## Docker 容器化运行

### 使用 GHCR 预构建镜像

项目通过 GitHub Actions 将 `main` 和 `v*` 版本标签构建为 amd64/arm64 镜像并发布到
`ghcr.io/123456yzj/vben-build-dashboard`。首次发布后，需要在 GitHub Packages 设置中将该容器包的
可见性改为 Public，服务器才能匿名拉取。

服务器需要预先安装 Docker Engine 和 Docker Compose v2。进入需要管理的目标 Monorepo 根目录后执行：

```bash
curl -fsSL https://raw.githubusercontent.com/123456yzj/vben-build-dashboard/main/deploy/install.sh | sudo bash
```

也可以明确指定目标仓库、端口和镜像版本：

```bash
curl -fsSL https://raw.githubusercontent.com/123456yzj/vben-build-dashboard/main/deploy/install.sh \
  | sudo env HOST_REPO_PATH=/srv/web-framework PORT=9527 VERSION=1.0.0 bash
```

安装文件保存在 `/opt/vben-build-dashboard`。重复执行命令会拉取指定镜像并更新容器，不会覆盖已有
`config.json`。可用变量包括 `IMAGE`、`VERSION`、`PORT`、`HOST_REPO_PATH` 和 `INSTALL_DIR`。

### 从源码构建

在项目根目录执行：

```bash
# 使用缓存一键重新编译并替换运行中的容器
bash rebuild-docker.sh

# 忽略缓存，全量重建镜像
bash rebuild-docker.sh --no-cache
```

`deploy/rebuild-docker.sh` 用于拉取 GHCR 镜像并升级已有的镜像部署，不执行本地源码构建。

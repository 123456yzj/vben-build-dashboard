# vben-control-dashboard

单人使用的 vben 项目远程控制面板。服务器运行 Node.js Agent，浏览器通过 HTTP 触发 Git 和构建操作，通过 WebSocket 接收实时日志。不需要数据库或登录服务。

## 目录

- `frontend/`：Vue 3 + TypeScript + Vite 界面
- `agent/`：Fastify + WebSocket 服务，执行 Git 与构建命令
- `config/projects.json`：本机项目清单（从 `config/projects.example.json` 复制）
- `data/build-history.json`：自动创建的最近 100 条构建记录
- `deploy/`：部署说明

## 配置

复制 `config/projects.example.json` 为 `config/projects.json`（若文件已存在则直接编辑），按服务器上的实际绝对路径填写：

```json
{
  "projects": [
    { "name": "vben", "path": "/data/projects/vben", "buildCommand": "pnpm build" },
    { "name": "vben-admin", "path": "/data/projects/vben-admin", "buildCommand": "pnpm build" }
  ]
}
```

项目名必须唯一。构建命令仅从服务器配置读取，浏览器不能提交任意 shell 命令。Agent 进程必须有项目目录、Git 凭据与依赖的访问权限；需要事先在项目目录安装依赖。远程 Git 凭据请在服务器提前配置，非交互式操作不会弹出密码提示。

## Docker 部署

需要 Docker Compose v2。项目目录需挂载到容器内**相同的绝对路径**；默认共享 `/data/projects`。如果项目都在 `/srv/projects`，创建根目录 `.env` 并填写 `PROJECTS_ROOT=/srv/projects`，同时把 JSON 中的路径设为 `/srv/projects/...`。

```bash
cp config/projects.example.json config/projects.json
# 编辑 config/projects.json，设置真实项目路径
docker compose up -d --build
```

浏览器访问 `http://server-ip:9527`；可在 `.env` 设置 `PORT=8080` 修改对外端口。`./data` 保存历史文件，项目目录挂载为可写以便 fetch、checkout、pull 和 build。镜像内含 Git、pnpm 9、Node.js 22；若项目构建还依赖系统工具，请扩展 Dockerfile。宿主机的 `node_modules` 中若有平台相关二进制文件，须在容器环境安装对应依赖。

**网络边界：** 面板无登录鉴权，能访问端口的用户可以执行配置中的 Git/构建操作。仅在可信内网或 VPN 暴露端口，不要直接对公网开放。

## 本地开发

Node.js 22.12+，项目路径必须是运行 Agent 的机器可访问的绝对路径。

```bash
cp config/projects.example.json config/projects.json
npm ci
npm run dev
```

浏览器访问 `http://localhost:5173`；Vite 代理 `/api` 和 `/ws` 到本地 Agent `9527`。`npm run typecheck` 检查前后端严格 TypeScript，`npm run build` 生成生产资源，`npm run start:agent` 启动已编译的服务。Agent 默认只监听 `127.0.0.1`，生产 Docker 显式监听 `0.0.0.0`。

Git 支持状态、分支列表、fetch、切分支与 `pull --ff-only`。工作区有改动时拒绝切分支和 pull；不执行 reset、clean、分支删除或自动冲突处理。同一项目同时只执行一个 Git/构建操作；其他项目可并行。构建日志在服务进程内保留最近 2000 个片段用于刷新后恢复，构建历史写入 JSON；服务重启后日志清空，未完成记录标记为失败。

# vben-control-dashboard

单人使用的 vben 项目远程控制面板。服务器运行 Node.js Agent，浏览器通过 HTTP 触发 Git 和构建操作，通过 WebSocket 接收实时日志。不需要数据库或登录服务。

## 目录

- `frontend/`：Vue 3 + TypeScript + Vite 界面
- `agent/`：Fastify + WebSocket 服务，执行 Git 与构建命令
- `config/projects.json`：本机项目清单（安装时创建空清单，或从 `config/projects.example.json` 复制）
- `data/build-history.json`：自动创建的最近 100 条构建记录
- `deploy/`：一键安装脚本与部署说明

## 配置

在 `config/projects.json` 中按服务器上的实际绝对路径填写项目（安装脚本会先创建 `{ "projects": [] }`）：

```json
{
  "projects": [
    { "name": "vben", "path": "/data/projects/vben", "buildCommand": "pnpm build" },
    { "name": "vben-admin", "path": "/data/projects/vben-admin", "buildCommand": "pnpm build" }
  ]
}
```

项目名必须唯一。构建命令仅从服务器配置读取，浏览器不能提交任意 shell 命令。Agent 进程必须有项目目录、Git 凭据与目标项目依赖的访问权限；目标项目自身的依赖仍需能在容器内使用。远程 Git 凭据请提前配置到容器可访问的位置，非交互式操作不会弹出密码提示。

## Docker 部署（推荐）

服务器只需要 Docker、Docker Compose v2 和下载脚本所用的 curl，无需克隆源码或在宿主机安装 Node.js、pnpm、面板依赖。镜像 `ghcr.io/123456yzj/vben-build-dashboard` 在 `main` 推送后发布 `latest`，推送 `v*` tag 后发布同名版本；首次安装前需确保相应镜像已发布且可以拉取（私有包需先 `docker login ghcr.io`）。

```bash
curl -fsSL https://raw.githubusercontent.com/123456yzj/vben-build-dashboard/main/deploy/install.sh | sudo bash
```

无参数时交互选择安装目录、项目根目录和端口；管道执行时从终端读取回答。传入任意参数即无交互运行：

```bash
curl -fsSL https://raw.githubusercontent.com/123456yzj/vben-build-dashboard/main/deploy/install.sh | sudo bash -s -- --install-dir /opt/vben --project-root /srv/projects --port 8080 --version v1.0.0
```

默认安装到 `/opt/vben-control-dashboard`，挂载 `/data/projects`，端口 `9527`，镜像标签为 `latest`。已有安装目录时交互安装会请求确认；参数模式需要添加 `--force` 才能覆盖。`--force` 会重置 `config/projects.json` 并覆盖 `.env`、Compose 文件，保留 `data/`。编辑安装目录下的 `config/projects.json` 后运行 `docker compose --project-directory /opt/vben-control-dashboard -f /opt/vben-control-dashboard/docker-compose.yml up -d --force-recreate` 使新项目清单生效。

手动安装也不需要源码。以 root 身份在服务器执行（所需目录及目标项目目录需要可写）：

```bash
mkdir -p /opt/vben-control-dashboard/config /opt/vben-control-dashboard/data /data/projects
cd /opt/vben-control-dashboard
curl -fsSL https://raw.githubusercontent.com/123456yzj/vben-build-dashboard/main/docker-compose.yml -o docker-compose.yml
printf '{"projects":[]}\n' > config/projects.json
printf 'PORT=9527\nPROJECTS_ROOT=/data/projects\nVERSION=latest\n' > .env
docker compose pull
docker compose up -d
```

项目目录在容器内保持**相同的绝对路径**；若设为 `/srv/projects`，`.env` 中的 `PROJECTS_ROOT` 与项目清单中的路径也应使用 `/srv/projects`。构建历史保存在 `data/`，挂载的项目目录可写以支持 Git 与构建。镜像内含 Git、pnpm 9、Node.js 22；目标项目如需额外系统工具或平台相关依赖，须在容器环境提供。

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

# Vben Workspace 管理器

管理一个或多个 vben 主工程，以及每个主工程 `app` 目录下独立的业务 Git 仓库。Agent 提供 HTTP API 与 WebSocket 日志，前端用于查看仓库分支、切分支、拉取更新及运行固定 dev 构建。无需数据库或登录服务。

## 配置

将 `config/workspaces.example.json` 复制为 `config/workspaces.json`，按 Agent 能访问的绝对路径填写主工程：

```json
{
  "workspaces": [{
    "name": "vben",
    "path": "/data/projects/vben",
    "repositoryDir": "app",
    "depth": 1
  }]
}
```

`repositoryDir` 默认为 `app`，`depth` 默认为 1（仅直接子目录），可设为 1 至 5。扫描到含 `.git` 目录或文件的子目录即加入仓库列表；深层仓库名使用相对于扫描目录的路径，例如 `group/tms`。构建只调用主工程 `package.json` 中实际存在的 `build:dev` 系列脚本，均在主工程目录执行：全量使用 `pnpm run build:dev`；单业务先尝试 `build:dev:<目录名>`，再用仓库 `package.json.name` 的末段匹配，例如 `@repo/admin` 对应 `build:dev:admin`。不执行仓库自己的构建脚本，也不接受客户端提供命令。没有匹配脚本的仓库仍会被扫描，但不可选中构建。构建前检查所有目标仓库 clean，dirty 仓库禁止构建；多业务构建按所选顺序依次执行，失败立即停止。每个业务构建前根据根目录 `.turbo/cache` 的 manifest 清理该业务对应的缓存，全量构建前清理整个缓存目录；构建进程设置 `TURBO_FORCE=true`，跳过本地及远程 Turbo 缓存。

Git 操作以仓库为目标：支持分支状态、fetch、切分支及 `pull --ff-only`。dirty 仓库禁止切分支和 pull。进行中的冲突操作直接拒绝，不排队或重试。最近 100 条构建任务保存在 `data/build-tasks.json`；日志只在 Agent 进程内暂存，重启后清空，未完成的任务标记为失败但不恢复执行。

## 从旧版本迁移

旧的 `config/projects.json` **不会自动读取或转换**。升级前备份该文件及 `data/build-history.json`；核对每个旧项目是否是 vben 主工程，在新的 `config/workspaces.json` 中填写其根目录与扫描目录，并确认项目内存在对应的 dev 构建脚本。旧的任意 `buildCommand` 不会迁移；新历史保存在 `data/build-tasks.json`，旧历史保留为归档。更新 Compose 的配置挂载与 `WORKSPACES_FILE` 后重建服务。安装脚本不会删除旧的 `projects.json`。

## Docker 部署

面板顶部可检测并安装已发布的更新。镜像推送到 `main` 后会同步发布运行文件包；更新按钮替换当前容器内的构建产物并重启服务。若依赖锁文件发生变化，需使用 `docker compose pull && docker compose up -d` 更新镜像。

服务器需要 Docker、Docker Compose v2 和 curl：

```bash
curl -fsSL https://raw.githubusercontent.com/123456yzj/vben-build-dashboard/main/deploy/install.sh | sudo bash
```

安装目录默认为 `/opt/vben-control-dashboard`，挂载的工程父目录默认为 `/data/projects`，端口默认为 `9527`。安装时生成空的 `config/workspaces.json`；填写后重建服务。`--force` 会覆盖受管理的 Workspace 配置、`.env` 和 Compose 文件，保留 `data/`，操作前应备份配置。手动部署可参照根目录 `docker-compose.yml`：准备 `.env`（`PORT`、`PROJECTS_ROOT`、`VERSION`）及 `config/workspaces.json`，然后运行 `docker compose up -d`。

配置中的绝对路径须在容器内保持一致，项目目录需有写权限；容器内已安装 Git、Node.js 22 和 pnpm 9，目标主工程的依赖及 Git 凭据仍需可用。面板不提供鉴权，只应暴露于可信内网或 VPN。

## 本地开发

Node.js 22.12+：

```bash
cp config/workspaces.example.json config/workspaces.json
npm ci
npm run dev
```

浏览器访问 `http://localhost:5173`，Vite 将 `/api` 和 `/ws` 代理至本地 Agent 的 9527 端口。运行 `npm run typecheck` 检查类型，`npm run build` 构建面板；Agent smoke test 位于 `agent/test/smoke.mjs`。

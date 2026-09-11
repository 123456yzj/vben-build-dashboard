# vben-build-dashboard 规格说明

## 1. 项目定位

`vben-build-dashboard` 是独立部署的轻量 Node.js 控制台，用于管理目标 Monorepo 的 Git 分支并执行开发环境打包。系统不介入业务源码，也不提供生产环境构建、依赖维护、运行时管理或产物部署能力。

## 2. 技术架构

- 语言：前后端业务代码统一使用 TypeScript，并启用严格类型检查。
- 后端：Koa、`@koa/router`、`koa-static`、`koa-bodyparser`。
- 实时通信：基于 `ws` 推送构建状态和终端日志。
- 前端：Vue 3 全局运行版，无前端编译步骤。
- 数据：使用 Node.js 内置 `node:sqlite` 缓存仓库状态。
- 命令执行：通过 `node:child_process` 调用 Git 与 pnpm。

## 3. 分支功能

- 扫描 Monorepo 根目录和 `apps/*` 子目录。
- 展示当前分支、最新提交、未提交文件和本地/远程分支。
- 支持单仓或全仓 `git fetch -p`。
- 支持单仓和多仓联动切换分支。
- 工作区存在改动时，可选择 stash、重置或取消切换。
- 支持查看、筛选和删除本地分支。
- 当前分支和受保护分支禁止删除。

## 4. 打包功能

- 仅允许 `development` 环境构建，API 拒绝其他构建模式。
- 支持单应用、多应用和全量打包。
- 同一时间只允许一个构建任务。
- 多应用任务按选择顺序依次执行。
- 支持实时日志、状态同步、断线重连和任务中止。

### 4.1 目标项目脚本约定

打包命令必须定义在目标 Monorepo 根目录的 `package.json` 中：

```json
{
  "scripts": {
    "build:dev": "全量开发环境打包命令",
    "build:dev:admin": "admin 开发环境打包命令",
    "build:dev:bms": "bms 开发环境打包命令"
  }
}
```

系统执行规则：

- 全量打包：`pnpm run build:dev`。
- `@repo/admin`：`pnpm run build:dev:admin`。
- `@repo/bms`：`pnpm run build:dev:bms`。

## 5. 配置

配置持久化在项目根目录的 `config.json`，支持以下字段：

```json
{
  "port": 9527,
  "host": "0.0.0.0",
  "targetRepoPath": "/workspace/repo",
  "protectedBranches": ["master", "main", "develop", "test"]
}
```

## 6. API 范围

- 配置：`/api/config`、`/api/config/validate`。
- 仓库：`/api/repos`。
- 分支：`/api/git/*`。
- 打包：`/api/build`、`/api/build/status`、`/api/build/abort`。
- WebSocket：`/ws`。

## 7. 运行方式

- 宿主机：`npm start`。
- 开发监听：`npm run dev`。
- Docker：`docker compose up --build -d`。

服务默认监听 `0.0.0.0:9527`。WSL Docker 模式下通过 `HOST_REPO_PATH` 指定目标 Monorepo；容器会保持相同的绝对路径，以兼容 pnpm 生成的依赖链接。

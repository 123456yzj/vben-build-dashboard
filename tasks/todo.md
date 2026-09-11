# TypeScript 迁移计划

> 状态：已完成。
> 范围假设：迁移前端、后端及 Windows bridge 的全部可执行 JavaScript；样式、Shell/Batch 与配置文件保持原格式。

## 迁移实施

- [x] 建立 TypeScript 基础设施
  - 为前后端补充严格模式 `tsconfig`、必要类型依赖和 `typecheck` 脚本。
  - 根工作区统一提供前端构建、后端构建和全量类型检查入口。
- [x] 建立业务类型契约
  - 定义配置、仓库、Git、构建状态、日志、目录选择、REST 响应及 WebSocket 消息类型。
  - 在网络、JSON、SQLite、子进程等不可信边界进行收窄，避免用 `any` 掩盖问题。
- [x] 迁移前端
  - 将 Vite 配置、入口和 `useDashboard` 迁移为 `.ts`。
  - 为 Vue SFC 启用 `<script setup lang="ts">`，补齐 props、emits 和 DOM ref 类型。
  - 更新 HTML 入口及源文件引用。
- [x] 迁移后端与 bridge
  - 将 Koa 服务、Git、SQLite、配置、构建管理和端口桥接模块迁移为 `.ts`。
  - 使用 Node ESM/NodeNext 兼容的导入与编译方式，保持现有 API、WebSocket 和进程管理行为。
- [x] 调整运行与部署链路
  - 开发环境使用 TS 运行入口，生产环境先编译后运行 `dist` 产物。
  - 更新根脚本、Docker 多阶段构建、启动命令及文档中的文件路径。
- [x] 验证并修复迁移问题
  - 运行前后端严格类型检查、前端生产构建、后端编译和 Node 启动冒烟检查。
  - 检查构建产物不包含旧 `.js/.mjs/.cjs` 源入口，并核对 Docker 构建链路。

## Review

- 前端入口、组合函数、Vite 配置和 10 个 Vue 脚本块已迁移为严格 TypeScript；纯模板组件保持不变。
- 后端 Koa 服务、bridge、Git、SQLite、配置和构建管理模块已迁移至 `backend/src`，生产输出为 `backend/dist`。
- 根工作区、两套 Dockerfile、Compose、启动脚本和项目文档已切换到 TypeScript 构建链路，Node 最低版本统一为 22.12。
- `npm run typecheck`、`npm run build`、编译产物 `node --check`、两套 `docker compose config --quiet` 均通过。
- 编译后的服务已在隔离端口完成 REST、SPA 静态页面及 WebSocket 初始消息冒烟验证，测试进程与临时数据库已清理。
- `docker compose build` 因本机 Docker Desktop Linux daemon 未启动而无法执行；Dockerfile 的实际镜像构建仍需在 daemon 可用时复验。
- 仓库原本没有自动化测试套件，本次未新增业务测试；类型检查、生产构建和协议冒烟是当前主要回归保障。

---

# GHCR 镜像发布与一键部署计划

> 状态：已完成。
> 默认镜像：`ghcr.io/123456yzj/vben-build-dashboard`。

## 实施

- [x] 新增 GitHub Actions 镜像发布工作流
  - 在推送 `main`、版本标签和手动触发时构建镜像并推送至 GHCR。
  - 发布 `latest`、语义化版本和提交 SHA 标签，并启用 amd64/arm64 多架构构建缓存。
- [x] 新增服务器一键安装脚本
  - 检查 Linux、root、Docker Engine 与 Compose 环境，生成受控的部署目录、Compose 和配置文件。
  - 从 GHCR 拉取指定版本并启动服务，支持 `IMAGE`、`VERSION`、`PORT`、`HOST_REPO_PATH` 等环境变量。
  - 重复执行时执行可预测的升级，不覆盖已有业务配置。
- [ ] 切换 Compose 为预构建镜像部署
  - `deploy/docker-compose.yml` 默认拉取 GHCR 镜像，保留根目录 Compose 作为本地源码构建入口。
  - 增加健康检查和镜像版本参数，保持目标仓库与 SQLite 数据持久化。
- [ ] 更新部署文档
  - 给出公开镜像的一行安装、指定目标仓库/版本、升级、查看日志和卸载命令。
  - 说明 GHCR Public 设置以及私有镜像登录方式。
- [x] 验证
  - Shell 语法检查、Compose 配置解析、安装脚本幂等/参数错误检查。
  - 校验 GitHub Actions YAML、镜像标签规则和现有 TypeScript 构建。

## Review

- 新增 `.github/workflows/publish-image.yml`，支持 `main`、`v*` 与手动触发，发布 `main`、`latest`、SemVer 和 `sha-*` 标签。
- 发布镜像使用 Buildx 构建 linux/amd64 与 linux/arm64，并通过 GitHub Actions Cache 加速后续构建。
- Dockerfile 改用官方 Node 22 Alpine 镜像与根 workspace 锁文件执行 `npm ci`，提高 GitHub 构建可用性和依赖可复现性。
- 新增 `deploy/install.sh`，支持公开 GHCR 镜像的一键安装、版本选择、端口配置、目标仓库挂载和幂等升级，不覆盖既有配置。
- `deploy/docker-compose.yml` 与 `deploy/rebuild-docker.sh` 已改为拉取预构建镜像；根 Compose 继续保留源码构建用途。
- 安装脚本通过 Bash 语法检查及两次连续执行的集成测试，错误端口、配置保留、Compose 内容和 Docker 调用均已验证。
- 两套 Compose 配置解析、npm 锁文件安装 dry-run、`npm run typecheck`、`npm run build` 和 `git diff --check` 均通过。
- 本机 Docker Desktop Linux daemon 未运行，且改动尚未提交到 GitHub，因此远端多架构构建与 GHCR 实际拉取需在推送后由 GitHub Actions 完成。

---

# 分步提交计划

> 状态：已完成。

- [x] 提交前后端 workspace 重构与 TypeScript 迁移（`5da5215`）。
- [x] 提交 Docker、GHCR 发布和一键部署能力（`eaaff63`）。
- [x] 提交 README、规格文档和任务记录。
- [x] 确认工作区无遗漏改动并复核提交历史。

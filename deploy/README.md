# Deploy Configuration & Scripts

本目录包含 `vben-build-dashboard` 的容器化及服务部署脚本与配置。

## 一键部署 GHCR 镜像

镜像地址为 `ghcr.io/123456yzj/vben-build-dashboard`，支持 amd64 和 arm64。服务器需要预先安装
Docker Engine 与 Docker Compose v2。进入需要管理的 Monorepo 根目录后执行：

```bash
curl -fsSL https://raw.githubusercontent.com/123456yzj/vben-build-dashboard/main/deploy/install.sh | sudo bash
```

指定目标仓库、宿主端口或镜像版本：

```bash
curl -fsSL https://raw.githubusercontent.com/123456yzj/vben-build-dashboard/main/deploy/install.sh \
  | sudo env HOST_REPO_PATH=/srv/web-framework PORT=9527 VERSION=1.0.0 bash
```

默认安装目录为 `/opt/vben-build-dashboard`。脚本会保留既有 `config.json`，因此可重复执行用于升级。
首次发布镜像后，需在 GitHub Packages 设置中将容器包改为 Public；私有包需要先以 root 身份登录 GHCR。

## 文件说明

- `Dockerfile`: 多阶段镜像构建文件（前端构建 -> 后端 TypeScript 编译 -> 生产运行镜像）。
- `docker-compose.yml`: 使用 GHCR 预构建镜像的 Docker Compose 服务编排配置。
- `install.sh`: 从 GHCR 拉取镜像并生成持久部署配置的一键安装脚本。
- `rebuild-docker.sh`: 拉取最新预构建镜像并重建容器的兼容升级脚本。
- `start.sh`: Linux / WSL 宿主机一键安装依赖、编译前后端并启动服务脚本（需要 Node.js 22.12+）。
- `setup-portproxy-9527.bat`: Windows 宿主机与 WSL 2 的 9527 端口转发自动化配置。

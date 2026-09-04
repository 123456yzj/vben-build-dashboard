FROM node:20-bookworm-slim

WORKDIR /app

# 安装 Git、rsync、curl 及常用进程查看工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    rsync \
    curl \
    ca-certificates \
    procps \
    && rm -rf /var/lib/apt/lists/*

# 全局安装最新版 pnpm
RUN npm install -g pnpm@latest

# 安装 NVM 支持在容器内部切换多版本 Node
ENV NVM_DIR=/root/.nvm
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# 复制依赖定义并安装运行依赖
COPY package.json ./
RUN npm install --omit=dev

# 复制项目所有文件
COPY . .

# 暴露服务端口
EXPOSE 9527
ENV HOST=0.0.0.0
ENV PORT=9527
ENV TARGET_REPO_PATH=/workspace/repo

CMD ["node", "server.mjs"]

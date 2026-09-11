#!/usr/bin/env bash

# ==============================================================================
# vben-build-dashboard 宿主机一键启动脚本
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "=================================================="
echo "  🚀 正在启动 vben-build-dashboard 控制台..."
echo "=================================================="

# 检查 Node 环境
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js，请先安装 Node.js 22.12+"
    exit 1
fi

echo "✔ 检测到 Node.js: $(node -v)"

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "📦 正在安装项目依赖 (npm install)..."
    npm install
fi

# 检查配置文件
if [ ! -f "config.json" ]; then
    echo "⚙️ 初始化默认配置文件 config.json..."
    cp config.example.json config.json
fi

# 编译前后端并启动服务
echo "✨ 服务启动中，监听地址: http://0.0.0.0:9527"
exec npm start

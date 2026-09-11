#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

readonly DEFAULT_IMAGE='ghcr.io/123456yzj/vben-build-dashboard'
readonly DEFAULT_VERSION='latest'
readonly DEFAULT_PORT='9527'
readonly DEFAULT_INSTALL_DIR='/opt/vben-build-dashboard'
readonly CALLING_DIR="$(pwd -P)"

log() {
  printf '[vben-build-dashboard] %s\n' "$*"
}

fail() {
  printf '[vben-build-dashboard] ERROR: %s\n' "$*" >&2
  exit 1
}

yaml_quote() {
  local value=${1//\'/\'\'}
  printf "'%s'" "$value"
}

json_quote() {
  local value=${1//\\/\\\\}
  value=${value//\"/\\\"}
  printf '"%s"' "$value"
}

[[ $(uname -s) == 'Linux' ]] || fail '此安装脚本仅支持 Linux。'
(( EUID == 0 )) || fail '请以 root 运行，例如: curl -fsSL <安装脚本 URL> | sudo bash'

command -v docker >/dev/null 2>&1 || fail '未检测到 Docker。请先通过发行版官方文档安装 Docker Engine；本脚本不会自动执行第三方安装脚本。'
docker compose version >/dev/null 2>&1 || fail '未检测到 Docker Compose v2 插件，请先安装后重试。'
docker info >/dev/null 2>&1 || fail '无法连接 Docker daemon，请确认 Docker 服务已启动且当前用户有访问权限。'

IMAGE=${IMAGE:-$DEFAULT_IMAGE}
VERSION=${VERSION:-$DEFAULT_VERSION}
PORT=${PORT:-$DEFAULT_PORT}
HOST_REPO_PATH=${HOST_REPO_PATH:-$CALLING_DIR}
INSTALL_DIR=${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}

[[ -n $IMAGE ]] || fail 'IMAGE 不能为空。'
[[ -n $VERSION ]] || fail 'VERSION 不能为空。'
[[ $IMAGE =~ ^[a-zA-Z0-9._/-]+$ ]] || fail "IMAGE 格式无效: $IMAGE"
[[ $VERSION =~ ^[a-zA-Z0-9._-]+$ ]] || fail "VERSION 格式无效: $VERSION"
[[ $PORT =~ ^[0-9]+$ ]] || fail "PORT 必须是数字，当前值: $PORT"
(( PORT >= 1 && PORT <= 65535 )) || fail "PORT 必须在 1 到 65535 之间，当前值: $PORT"
[[ -d $HOST_REPO_PATH ]] || fail "HOST_REPO_PATH 不存在或不是目录: $HOST_REPO_PATH"
[[ -e $HOST_REPO_PATH/package.json || -e $HOST_REPO_PATH/.git ]] || fail 'HOST_REPO_PATH 必须是包含 package.json 或 .git 的项目目录。'
[[ $HOST_REPO_PATH != *$'\n'* && $HOST_REPO_PATH != *$'\r'* && $HOST_REPO_PATH != *$'\t'* ]] || fail 'HOST_REPO_PATH 不能包含控制字符。'
[[ $INSTALL_DIR = /* ]] || fail "INSTALL_DIR 必须是绝对路径: $INSTALL_DIR"
[[ $INSTALL_DIR != *$'\n'* && $INSTALL_DIR != *$'\r'* && $INSTALL_DIR != *$'\t'* ]] || fail 'INSTALL_DIR 不能包含控制字符。'

HOST_REPO_PATH="$(cd "$HOST_REPO_PATH" && pwd -P)"
mkdir -p "$INSTALL_DIR"

CONFIG_PATH="$INSTALL_DIR/config.json"
COMPOSE_PATH="$INSTALL_DIR/compose.yaml"
IMAGE_REF="$IMAGE:$VERSION"

if [[ ! -e $CONFIG_PATH ]]; then
  {
    printf '{\n'
    printf '  "port": 9527,\n'
    printf '  "host": "0.0.0.0",\n'
    printf '  "targetRepoPath": %s,\n' "$(json_quote "$HOST_REPO_PATH")"
    printf '  "protectedBranches": ["master", "main", "develop", "test"]\n'
    printf '}\n'
  } >"$CONFIG_PATH"
  chmod 600 "$CONFIG_PATH"
  log "已创建持久配置: $CONFIG_PATH"
else
  log "保留现有配置: $CONFIG_PATH"
fi

{
  printf 'services:\n'
  printf '  dashboard:\n'
  printf '    image: %s\n' "$(yaml_quote "$IMAGE_REF")"
  printf '    restart: unless-stopped\n'
  printf '    ports:\n'
  printf '      - %s\n' "$(yaml_quote "$PORT:9527")"
  printf '    environment:\n'
  printf '      HOST: %s\n' "$(yaml_quote '0.0.0.0')"
  printf '      PORT: %s\n' "$(yaml_quote '9527')"
  printf '      TARGET_REPO_PATH: %s\n' "$(yaml_quote "$HOST_REPO_PATH")"
  printf '      CONFIG_PATH: %s\n' "$(yaml_quote '/app/config.json')"
  printf '      DATA_DIR: %s\n' "$(yaml_quote '/app/data')"
  printf '      STATIC_DIR: %s\n' "$(yaml_quote '/app/frontend/dist')"
  printf '    volumes:\n'
  printf '      - type: bind\n'
  printf '        source: %s\n' "$(yaml_quote "$HOST_REPO_PATH")"
  printf '        target: %s\n' "$(yaml_quote "$HOST_REPO_PATH")"
  printf '      - type: bind\n'
  printf '        source: %s\n' "$(yaml_quote "$CONFIG_PATH")"
  printf '        target: %s\n' "$(yaml_quote '/app/config.json')"
  printf '      - type: volume\n'
  printf '        source: dashboard-data\n'
  printf '        target: %s\n' "$(yaml_quote '/app/data')"
  printf 'volumes:\n'
  printf '  dashboard-data:\n'
} >"$COMPOSE_PATH"

log "拉取镜像: $IMAGE_REF"
docker compose --project-directory "$INSTALL_DIR" -f "$COMPOSE_PATH" pull
docker compose --project-directory "$INSTALL_DIR" -f "$COMPOSE_PATH" up -d --remove-orphans

log "部署完成: http://localhost:$PORT"
log "部署目录: $INSTALL_DIR"

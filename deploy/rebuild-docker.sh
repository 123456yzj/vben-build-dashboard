#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is not installed or is not available in PATH."
    exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose v2 is required."
    exit 1
fi

if [ ! -f "$REPO_ROOT/config.json" ]; then
    cp "$REPO_ROOT/config.example.json" "$REPO_ROOT/config.json"
    echo "Created config.json from config.example.json."
fi

case "${1:-}" in
    "")
        docker compose pull
        ;;
    --no-cache)
        echo "The deployment uses a prebuilt image; pulling the latest image instead."
        docker compose pull
        ;;
    *)
        echo "Usage: $0 [--no-cache]"
        exit 2
        ;;
esac

CONTAINER_NAME="vben-build-dashboard"
EXISTING_CONTAINER_ID="$(docker ps -aq --filter "name=^/${CONTAINER_NAME}$")"
if [ -n "$EXISTING_CONTAINER_ID" ]; then
    echo "Removing existing container: $CONTAINER_NAME"
    docker rm -f "$EXISTING_CONTAINER_ID"
fi

docker compose up -d --force-recreate --remove-orphans --pull always

docker compose ps
echo "Dashboard rebuilt: http://localhost:9527"

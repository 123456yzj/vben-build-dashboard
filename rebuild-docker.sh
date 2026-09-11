#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is not installed or is not available in PATH."
    exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose v2 is required."
    exit 1
fi

if [ ! -f config.json ]; then
    cp config.example.json config.json
    echo "Created config.json from config.example.json."
fi

case "${1:-}" in
    "")
        docker compose build
        ;;
    --no-cache)
        docker compose build --no-cache
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

docker compose up -d --force-recreate --remove-orphans

docker compose ps
echo "Dashboard rebuilt: http://localhost:9527"

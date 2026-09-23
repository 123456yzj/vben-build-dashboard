#!/usr/bin/env bash
set -euo pipefail

install_dir=/opt/vben-control-dashboard
project_root=/data/projects
port=9527
version=latest
force=false
parameter_mode=false
compose_url=https://raw.githubusercontent.com/123456yzj/vben-build-dashboard/main/docker-compose.yml

usage() {
  cat <<'EOF'
Usage: install.sh [--install-dir PATH] [--project-root PATH] [--port PORT] [--version TAG] [--force]

With no arguments, prompts for paths and port. With arguments, runs without prompts.
--force overwrites the managed compose file, .env and config/workspaces.json; data/ is preserved.
EOF
}

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

while (($#)); do
  parameter_mode=true
  case "$1" in
    --install-dir|--project-root|--port|--version)
      (($# >= 2)) || die "Missing value for $1"
      case "$1" in
        --install-dir) install_dir=$2 ;;
        --project-root) project_root=$2 ;;
        --port) port=$2 ;;
        --version) version=$2 ;;
      esac
      shift 2 ;;
    --force) force=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

if ! $parameter_mode; then
  [[ -r /dev/tty ]] || die 'Interactive installation requires a terminal; pass arguments for unattended installation'
  read -r -p "Install directory [$install_dir]: " input </dev/tty
  install_dir=${input:-$install_dir}
  read -r -p "Project root [$project_root]: " input </dev/tty
  project_root=${input:-$project_root}
  read -r -p "Port [$port]: " input </dev/tty
  port=${input:-$port}
fi

[[ "$install_dir" = /* && "$install_dir" != *$'\n'* ]] || die 'Install directory must be an absolute path without newlines'
[[ "$project_root" = /* && "$project_root" != *[[:space:]:\#\$]* ]] || die 'Project root must be an absolute path without spaces, colon, # or $'
[[ "$port" =~ ^[0-9]+$ ]] || die 'Port must be a number between 1 and 65535'
((10#$port >= 1 && 10#$port <= 65535)) || die 'Port must be between 1 and 65535'
[[ "$version" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$ ]] || die 'Invalid Docker image tag'

command -v docker >/dev/null 2>&1 || die 'Docker is required'
docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 is required'
docker info >/dev/null 2>&1 || die 'Docker daemon is unavailable'
command -v curl >/dev/null 2>&1 || die 'curl is required to download docker-compose.yml'

if [[ -e "$install_dir" && "$force" != true ]]; then
  if $parameter_mode; then
    die "Install directory already exists: $install_dir (use --force to overwrite managed configuration)"
  fi
  read -r -p "Directory $install_dir exists. Continue and keep existing project configuration? [y/N] " answer </dev/tty
  [[ "$answer" =~ ^[yY]([eE][sS])?$ ]] || die 'Installation cancelled'
elif ! $parameter_mode; then
  read -r -p "Install into $install_dir with projects at $project_root on port $port? [y/N] " answer </dev/tty
  [[ "$answer" =~ ^[yY]([eE][sS])?$ ]] || die 'Installation cancelled'
fi

mkdir -p "$install_dir/config" "$install_dir/data" "$project_root"
temp_file=$(mktemp "$install_dir/.docker-compose.yml.XXXXXX")
trap 'rm -f "$temp_file"' EXIT
curl --fail --location --silent --show-error --output "$temp_file" "$compose_url"
if [[ "$force" == true || ! -f "$install_dir/config/workspaces.json" ]]; then
  printf '{\n  "workspaces": []\n}\n' > "$install_dir/config/workspaces.json"
fi
printf 'PORT=%s\nPROJECTS_ROOT=%s\nVERSION=%s\n' "$port" "$project_root" "$version" > "$install_dir/.env"
mv -f "$temp_file" "$install_dir/docker-compose.yml"
docker compose --project-directory "$install_dir" -f "$install_dir/docker-compose.yml" config --quiet
docker compose --project-directory "$install_dir" -f "$install_dir/docker-compose.yml" pull
docker compose --project-directory "$install_dir" -f "$install_dir/docker-compose.yml" up -d

printf 'Installed in %s\nEdit %s/config/workspaces.json to add Workspaces, then restart the service.\nOpen http://localhost:%s/ (or use the server IP).\n' "$install_dir" "$install_dir" "$port"

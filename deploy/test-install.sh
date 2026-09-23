#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
export compose_source="$repo/docker-compose.yml"
export command_log="$temp/docker-commands"

docker() {
  printf '%s\n' "$*" >> "$command_log"
  case "$*" in
    'info'|'compose version'|*' config --quiet'|*' pull'|*' up -d') return 0 ;;
    *) return 1 ;;
  esac
}

curl() {
  local output=
  while (($#)); do
    if [[ "$1" == --output ]]; then output=$2; shift 2; else shift; fi
  done
  [[ -n "$output" ]] || return 1
  cp "$compose_source" "$output"
}
export -f docker curl

install_dir="$temp/install"
project_root="$temp/projects"
bash "$repo/deploy/install.sh" --install-dir "$install_dir" --project-root "$project_root" --port 8080 --version v1.0.0
cmp "$compose_source" "$install_dir/docker-compose.yml"
diff -u <(printf 'PORT=8080\nPROJECTS_ROOT=%s\nVERSION=v1.0.0\n' "$project_root") "$install_dir/.env"
[[ -d "$install_dir/data" && -d "$project_root" ]]
[[ $(<"$install_dir/config/workspaces.json") == *'"workspaces": []'* ]]
[[ $(<"$command_log") == *' pull'* && $(<"$command_log") == *' up -d'* ]]

if bash "$repo/deploy/install.sh" --install-dir "$install_dir" --port 8081; then
  printf 'Existing installation should require --force in parameter mode\n' >&2
  exit 1
fi

printf 'keep history\n' > "$install_dir/data/marker"
printf 'old config\n' > "$install_dir/config/workspaces.json"
bash "$repo/deploy/install.sh" --install-dir "$install_dir" --project-root "$project_root" --port 9527 --version latest --force
diff -u <(printf 'PORT=9527\nPROJECTS_ROOT=%s\nVERSION=latest\n' "$project_root") "$install_dir/.env"
[[ $(<"$install_dir/config/workspaces.json") == *'"workspaces": []'* ]]
[[ $(<"$install_dir/data/marker") == 'keep history' ]]
printf 'Installation smoke test passed\n'

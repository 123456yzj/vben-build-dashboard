# Deployment

The recommended installation requires only Docker, Docker Compose v2 and curl on the server. It downloads the root `docker-compose.yml` and pulls `ghcr.io/123456yzj/vben-build-dashboard:latest`; no source checkout or local image build is needed:

```sh
curl -fsSL https://raw.githubusercontent.com/123456yzj/vben-build-dashboard/main/deploy/install.sh | sudo bash
```

For unattended installation, pass flags after `bash -s --`, for example `--project-root /srv/projects --port 8080 --version v1.0.0`. `--install-dir` defaults to `/opt/vben-control-dashboard`; `--force` overwrites managed configuration (including `config/projects.json`) but keeps `data/`. The script creates an empty project list for manual editing; it does not scan projects. GitHub Actions publishes `latest` from `main` and versioned images from `v*` tags. The GHCR package must be available to the server (log in to GHCR first for private packages).

For manual Compose deployment, download the root Compose file into a directory containing `.env`, `config/projects.json` and `data/`, then run `docker compose pull` and `docker compose up -d` there. When working from a source checkout, `deploy/docker-compose.yml` is an equivalent image-based file with paths relative to the repository root; run it with `docker compose -f deploy/docker-compose.yml up -d`. Set `PROJECTS_ROOT` in `.env` to the common absolute parent of every configured project; paths are mounted identically inside the container. See the root README for target-project dependencies, Git credentials and network requirements.

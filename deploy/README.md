# Deployment

Run `docker compose up -d --build` from the repository root after creating `config/projects.json` from the example. The root compose file and `deploy/docker-compose.yml` both build the local source; for the latter run `docker compose -f deploy/docker-compose.yml up -d --build` from the repository root. Set `PROJECTS_ROOT` in `.env` to the common absolute parent of every configured project; paths are mounted identically inside the container. See the root README for configuration, dependency and network requirements.

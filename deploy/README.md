# Deployment

Run `deploy/install.sh` on the server, or use the root `docker-compose.yml` with `.env`, `config/workspaces.json`, and `data/` in the installation directory. The installer creates an empty `workspaces.json`; configure each vben root and restart the service. The `--force` flag overwrites managed configuration (`workspaces.json`, `.env`, Compose), but retains `data/` and the old `projects.json` file. Back up configuration before using it.

Set `PROJECTS_ROOT` in `.env` to a common absolute parent of every Workspace. The bind mount keeps paths identical inside the container. See the root README for the configuration schema, migration instructions, target-project dependencies, and Git credentials.

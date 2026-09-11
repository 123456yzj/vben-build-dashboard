# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-alpine
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org

# -----------------------------------------------------------------------------
# Base Image
# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime-base
ARG NPM_CONFIG_REGISTRY

WORKDIR /app

RUN npm config set registry "${NPM_CONFIG_REGISTRY}" && \
    apk add --no-cache git bash ca-certificates tzdata && \
    npm install -g pnpm@9.15.5 && \
    npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 1: Install Locked Workspace Dependencies
# -----------------------------------------------------------------------------
FROM runtime-base AS workspace-dependencies
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci --no-audit --no-fund

# -----------------------------------------------------------------------------
# Stage 2: Build Frontend
# -----------------------------------------------------------------------------
FROM workspace-dependencies AS frontend-builder
WORKDIR /app

COPY frontend ./frontend
RUN npm run build -w frontend

# -----------------------------------------------------------------------------
# Stage 3: Build Backend
# -----------------------------------------------------------------------------
FROM workspace-dependencies AS backend-builder
WORKDIR /app

COPY backend ./backend
RUN npm run build -w backend

# -----------------------------------------------------------------------------
# Stage 4: Backend Production Dependencies
# -----------------------------------------------------------------------------
FROM runtime-base AS backend-dependencies
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci --omit=dev --workspace backend --include-workspace-root=false --no-audit --no-fund && \
    npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 5: Final Production Runtime
# -----------------------------------------------------------------------------
FROM runtime-base
WORKDIR /app

COPY --from=backend-dependencies /app/node_modules ./node_modules
COPY backend/package.json ./backend/package.json
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY config.example.json ./

EXPOSE 9527
ENV HOST=0.0.0.0 \
    PORT=9527 \
    TARGET_REPO_PATH=/workspace/repo \
    CONFIG_PATH=/app/config.json \
    DATA_DIR=/app/data \
    STATIC_DIR=/app/frontend/dist

CMD ["node", "backend/dist/server.js"]

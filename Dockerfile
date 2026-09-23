FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY agent/package.json agent/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY agent agent
COPY frontend frontend
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache git bash ca-certificates && npm install -g pnpm@9.15.5
COPY package.json package-lock.json ./
COPY agent/package.json agent/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/agent/dist agent/dist
COPY --from=build /app/frontend/dist frontend/dist
ENV HOST=0.0.0.0 PORT=9527 PROJECTS_FILE=/app/config/projects.json HISTORY_FILE=/app/data/build-history.json STATIC_DIR=/app/frontend/dist
EXPOSE 9527
CMD ["node", "agent/dist/server.js"]

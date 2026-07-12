# Build context is the repo root:  docker build -f server/Dockerfile .
#
# The web app is intentionally NOT built here — vite on a small cloud instance
# takes tens of minutes. Build it on a dev machine (npm run build) and put
# app/dist into server/web/, which docker-compose mounts read-only as WEB_DIR.
# Web-only deploys then need no image rebuild at all.
FROM node:22-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY app/package.json app/
COPY server/package.json server/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev -w server -w shared

FROM node:22-bookworm-slim
WORKDIR /repo
ENV NODE_ENV=production DATA_DIR=/data PORT=8787 WEB_DIR=/web
COPY --from=deps /repo/node_modules node_modules
COPY shared shared
COPY server server
EXPOSE 8787
VOLUME /data
CMD ["node_modules/.bin/tsx", "server/src/index.ts"]

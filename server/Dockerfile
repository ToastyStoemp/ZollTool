# Build context is the repo root:  docker build -f server/Dockerfile .
#
# The web app is intentionally NOT built here — vite on a small cloud instance
# takes tens of minutes. `npm run deploy:web` on a dev machine packs the build
# into server/web-dist.zip (committed to git); the server unpacks and serves it
# at startup. A web deploy is therefore: commit, git pull, compose up --build
# (fast — only COPY layers change).
FROM node:22-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY app/package.json app/
COPY server/package.json server/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev -w server -w shared

FROM node:22-bookworm-slim
WORKDIR /repo
ENV NODE_ENV=production DATA_DIR=/data PORT=8787
COPY --from=deps /repo/node_modules node_modules
COPY shared shared
COPY server server
EXPOSE 8787
VOLUME /data
CMD ["node_modules/.bin/tsx", "server/src/index.ts"]

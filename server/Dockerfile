# Build context is the repo root:  docker build -f server/Dockerfile .
FROM node:22-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY app/package.json app/
COPY server/package.json server/
RUN npm ci --omit=dev -w server -w shared

FROM node:22-bookworm-slim
WORKDIR /repo
ENV NODE_ENV=production DATA_DIR=/data PORT=8787
COPY --from=deps /repo/node_modules node_modules
COPY shared shared
COPY server server
EXPOSE 8787
VOLUME /data
CMD ["node_modules/.bin/tsx", "server/src/index.ts"]

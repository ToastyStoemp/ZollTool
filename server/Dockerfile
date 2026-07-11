# Build context is the repo root:  docker build -f server/Dockerfile .
FROM node:22-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY app/package.json app/
COPY server/package.json server/
RUN npm ci --omit=dev -w server -w shared

# Build the web app so the server can serve it at / (use ZollTool from a browser)
FROM node:22-bookworm-slim AS webbuild
WORKDIR /repo
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY app/package.json app/
COPY server/package.json server/
RUN npm ci -w app -w shared
COPY shared shared
COPY app app
RUN npm run build -w app

FROM node:22-bookworm-slim
WORKDIR /repo
ENV NODE_ENV=production DATA_DIR=/data PORT=8787 WEB_DIR=/repo/app/dist
COPY --from=deps /repo/node_modules node_modules
COPY shared shared
COPY server server
COPY --from=webbuild /repo/app/dist app/dist
EXPOSE 8787
VOLUME /data
CMD ["node_modules/.bin/tsx", "server/src/index.ts"]

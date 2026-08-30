#!/usr/bin/env bash
# Auto-deploy gate for the sync server. Meant to be invoked remotely (e.g. by
# .github/workflows/deploy-server.yml over SSH) after every push, but only
# actually pulls/rebuilds when the server's own server/.env opts in — a push
# to GitHub never redeploys a server that hasn't explicitly set AUTO_DEPLOY=1
# itself. Run from the repo root, or from anywhere: it cd's there first.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

ENV_FILE="server/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "No $ENV_FILE on this server — auto-deploy not configured, skipping."
  exit 0
fi

AUTO_DEPLOY="$(grep -E '^AUTO_DEPLOY=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
if [ "$AUTO_DEPLOY" != "1" ] && [ "$AUTO_DEPLOY" != "true" ]; then
  echo "AUTO_DEPLOY not enabled in $ENV_FILE — skipping. (Set AUTO_DEPLOY=1 there to opt in.)"
  exit 0
fi

echo "AUTO_DEPLOY enabled — pulling and rebuilding..."
git pull --ff-only

compose_files=(-f server/docker-compose.yml)
if [ -f server/docker-compose.override.yml ]; then
  compose_files+=(-f server/docker-compose.override.yml)
fi

# Record the deployed commit where the server reads it at boot (the container has
# no .git). Written into the mounted data volume; the server resolves it via
# resolveCommit(). server/data maps to /data in the container.
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then GIT_SHA="${GIT_SHA}-dirty"; fi
mkdir -p server/data
echo "$GIT_SHA" > server/data/commit
echo "  deployed commit: $GIT_SHA"

docker compose "${compose_files[@]}" --env-file "$ENV_FILE" up -d --build
echo "Deploy complete."

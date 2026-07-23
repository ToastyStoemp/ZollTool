# ZollTool sync server

Optional companion server for the ZollTool app: accounts, multi-device sync, and image storage.
The app works fully offline without it — devices that log in push/pull their change log here.

## Run with Docker

From the repo root:

```sh
# one-time: create server/.env
cat > server/.env <<EOF
JWT_SECRET=change-me-to-a-long-random-string
OWNER_EMAIL=you@example.com
OWNER_PASSWORD=pick-a-strong-password
EOF

docker compose -f server/docker-compose.yml --env-file server/.env up -d --build
```

The server listens on port 8787 (HTTP + WebSocket). Put a TLS-terminating reverse proxy
(Caddy, nginx, Traefik) in front of it for internet use. All state lives in `server/data/`
(SQLite database + image files) — back that folder up.

### Machine-specific compose settings

Don't edit `docker-compose.yml` on the server — git pulls will conflict. Put host-specific
additions (proxy networks, container_name, …) in `server/docker-compose.override.yml`
(gitignored) and pass both files:

```yaml
# server/docker-compose.override.yml — example: join the reverse proxy's network
services:
  zolltool:
    container_name: zolltool
    networks: [default, zollnet]
networks:
  zollnet:
    external: true
```

```sh
docker compose -f server/docker-compose.yml -f server/docker-compose.override.yml \
  --env-file server/.env up -d --build
```

## Web app in the browser

The server serves the built web app at `/`: browse to the server URL, log in, and use
ZollTool (POS, catalog, history, admin) from any browser.

The web app is **built on a dev machine, not on the server** — vite on a small cloud
instance takes tens of minutes, on a PC seconds. The build ships as `server/web-dist.zip`,
**committed to git** and unpacked by the server at startup, so git is the transfer channel
(no scp, no SSH keys):

```sh
# on the dev machine, from the repo root
npm run deploy:web            # builds app/dist and packs server/web-dist.zip
git commit -am "web build" && git push

# on the server
git pull
docker compose -f server/docker-compose.yml --env-file server/.env up -d --build
```

The rebuild is fast — only COPY layers change; npm deps stay cached (BuildKit cache mount).
What gets served, in order of precedence: explicit `WEB_DIR` env → the committed zip →
`../app/dist` (dev fallback). With none of these the server is API-only.

## Android app self-updates

The server also hosts the Android APKs for in-app self-update (Settings → App updates on the
device). Same pattern as the web build — **built on a dev machine, committed to git**, no
per-device file transfer:

```sh
# on the dev machine, from the repo root
npm run bump:version          # stamps a fresh versionCode/versionName into android/app/build.gradle
npx cap sync android
cd android && .\gradlew.bat assembleDebug && cd ..   # builds all 3 flavors
npm run pack:apk              # copies them + writes server/apk/version.json from build.gradle
git add server/apk android/app/build.gradle && git commit -m "app update" && git push

# on the server
git pull
docker compose -f server/docker-compose.yml --env-file server/.env up -d --build
```

`bump:version` matters — skip it and every build still reports itself as whatever
versionCode/versionName was last committed, so the app never thinks it's caught up and
"update available" never clears.

Each device downloads only its own flavor (detected at runtime from which native payment
plugin is present). Installing still needs the user's one-time "allow installs from this app"
consent — Android doesn't let an app silently replace itself. `server/apk/` is empty until the
first `pack:apk` run; devices just see "no update published" until then.

## Accounts

- The **owner** account is seeded from `OWNER_EMAIL` / `OWNER_PASSWORD` on first boot.
- Registration needs an **invite code** (`POST /api/invites` as a logged-in admin, or from the
  app once the admin panel ships). Invites either join your account (helpers' devices) or —
  owner-only, `newAccount: true` — create a brand-new account.
- Set `REGISTRATION_OPEN=1` to let anyone create an account without an invite.

## Development

```sh
npm run dev:server          # tsx watch, port 8787
npm run test -w server      # integration tests (in-memory data dir)
```

Required env: `JWT_SECRET`. Optional: `PORT` (8787), `DATA_DIR` (./data),
`OWNER_EMAIL`/`OWNER_PASSWORD`, `REGISTRATION_OPEN`.

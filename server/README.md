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

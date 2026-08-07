#!/usr/bin/env bash
# Boots one preview env inside its container: check out the PR commit on top of the
# image's cached repo, restore the per-env db from the sanitized template, then run
# web + api + game-server as children of one PID 1 (the container is the unit —
# `podman rm -f` tears the whole env down).
#
# Required env: PR (pr number), SHA (commit to check out), MONGO_URL.
# Optional:     WEB_PORT (8612), API_PORT (50801), WS_PORT (50802), GS_PORT (50803),
#               RESOURCES_PORT (50804).
set -euo pipefail

: "${PR:?}" "${SHA:?}" "${MONGO_URL:?}"
WEB_PORT="${WEB_PORT:-8612}"
API_PORT="${API_PORT:-50801}"
WS_PORT="${WS_PORT:-50802}"
GS_PORT="${GS_PORT:-50803}"
RESOURCES_PORT="${RESOURCES_PORT:-50804}"
ADMIN_PORT="${ADMIN_PORT:-50805}"
DB="bgs-pr-${PR}"
TEMPLATE="bgs-preview-template"

cd /repo

echo "[entrypoint] fetching $SHA"
git fetch --filter=blob:none origin "$SHA"
git checkout --force FETCH_HEAD

# Only reinstall when the lockfile moved vs the commit baked into the image
# (common case: it didn't — node_modules from the image build is reused as-is).
if ! git diff --quiet "$(cat /repo/.image-base-ref)" FETCH_HEAD -- pnpm-lock.yaml 2>/dev/null; then
  echo "[entrypoint] lockfile changed, reinstalling"
  CI=true pnpm install --frozen-lockfile
fi

echo "[entrypoint] building web"
VITE_backend=127.0.0.1 \
VITE_backend_api="127.0.0.1:${API_PORT}" \
VITE_backend_gameplay="127.0.0.1:${GS_PORT}" \
VITE_backend_ws="127.0.0.1:${WS_PORT}" \
pnpm --filter @bgs/web build

echo "[entrypoint] building admin"
# The admin SPA calls a relative /api at runtime; the coyo vhost for
# admin-pr-<n>.boardgamers.space proxies that to this env's api port, so no API URL
# is baked into the build.
pnpm --filter @bgs/admin build

echo "[entrypoint] restoring db ${DB} from ${TEMPLATE}"
until mongosh --quiet "$MONGO_URL/admin" --eval 'db.runCommand({ping:1})' >/dev/null 2>&1; do sleep 1; done
mongosh --quiet "$MONGO_URL/admin" --eval "db.getSiblingDB('${DB}').dropDatabase()" >/dev/null
if [ -d "/dumps/template/${TEMPLATE}" ]; then
  mongorestore --uri="$MONGO_URL" --db="$DB" --nsFrom="${TEMPLATE}.*" --nsTo="${DB}.*" "/dumps/template/${TEMPLATE}"
else
  echo "[entrypoint] no template dump yet, starting from an empty db"
fi

export NODE_ENV=production cron=false
export dbUrl="$MONGO_URL" dbName="$DB" listenHost=0.0.0.0
export domain="pr-${PR}.boardgamers.space"

cd /repo/apps/api
port="$API_PORT" wsPort="$WS_PORT" resourcesPort="$RESOURCES_PORT" node server.ts &
# api cron as a separate process (serving + cron in one process only happens in dev;
# in prod the cron process must not bind the ports). Gated by the db locks so the
# game-server's own cron doesn't double-fire shared work.
cron=true node server.ts &
cd /repo/apps/game-server
# One game-server process doing BOTH serve + cron in production mode (previews have no
# PM2 worker/cron split): cron=true installs engines & starts/times-out games, and
# serve=true forces it to also bind the gameplay port (server.ts normally skips
# listening when cron=true in prod, to avoid EADDRINUSE against a PM2 worker).
# Emails are off (automatedEmails defaults false) so notifications don't spam.
port="$GS_PORT" cron=true serve=true node server.ts &
cd /repo/apps/web/build
HOST=0.0.0.0 PORT="$WEB_PORT" node index.js &
# Admin SPA (static, built above) on its own port; coyo routes admin-pr-<n> here.
cd /repo
ADMIN_ROOT=/repo/apps/admin/dist ADMIN_PORT="$ADMIN_PORT" node /usr/local/bin/serve-admin.mjs &

trap 'kill 0' TERM INT
wait -n
# First child to exit takes the env down with it — a half-dead env is worse than none.
kill 0
exit 1

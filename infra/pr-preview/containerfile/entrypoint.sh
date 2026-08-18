#!/usr/bin/env bash
# Boots one preview env inside its container: check out the PR commit on top of the
# image's cached repo, seed the per-env db from the sanitized template on FIRST boot
# only (later restarts/updates keep the db as-is), then run web + api + game-server
# as children of one PID 1 (the container is the unit — `podman rm -f` tears the
# whole env down).
#
# Required env: PR (pr number), SHA (commit to check out), MONGO_URL.
# Optional:     WEB_PORT (8612), API_PORT (50801), WS_PORT (50802), GS_PORT (50803),
#               RESOURCES_PORT (50804), ADMIN_PORT (50805), DOCS_PORT (50806).
set -euo pipefail

: "${PR:?}" "${SHA:?}" "${MONGO_URL:?}"
WEB_PORT="${WEB_PORT:-8612}"
API_PORT="${API_PORT:-50801}"
WS_PORT="${WS_PORT:-50802}"
GS_PORT="${GS_PORT:-50803}"
RESOURCES_PORT="${RESOURCES_PORT:-50804}"
ADMIN_PORT="${ADMIN_PORT:-50805}"
DOCS_PORT="${DOCS_PORT:-50806}"
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

until mongosh --quiet "$MONGO_URL/admin" --eval 'db.runCommand({ping:1})' >/dev/null 2>&1; do sleep 1; done
# Seed only on first boot (db missing/empty). On a restart or code update the env
# db already holds data — including anything added on the preview — so it must NOT
# be dropped and re-imported from the template.
if [ "$(/usr/local/bin/db-needs-seed.sh "$MONGO_URL" "$DB")" = "yes" ]; then
  echo "[entrypoint] first boot: seeding db ${DB} from ${TEMPLATE}"
  mongosh --quiet "$MONGO_URL/admin" --eval "db.getSiblingDB('${DB}').dropDatabase()" >/dev/null
  if [ -d "/dumps/template/${TEMPLATE}" ]; then
    mongorestore --uri="$MONGO_URL" --db="$DB" --nsFrom="${TEMPLATE}.*" --nsTo="${DB}.*" "/dumps/template/${TEMPLATE}"
  else
    echo "[entrypoint] no template dump yet, starting from an empty db"
  fi
else
  echo "[entrypoint] db ${DB} already has data, skipping template restore"
fi

export NODE_ENV=production cron=false
export dbUrl="$MONGO_URL" dbName="$DB" listenHost=0.0.0.0
export domain="pr-${PR}.boardgamers.space"
# Containerfile installs Chromium here for /og/share.png; re-export in case the
# image was started with a sanitized env (docker run -i, systemd, …).
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}"

# If a lockfile change above pulled a playwright version whose browser isn't in the
# image, fetch it now (additive — existing revisions in the shared path are kept).
apps_web_bin=/repo/apps/web/node_modules/.bin/playwright
if [ -x "$apps_web_bin" ] && ! "$apps_web_bin" install chromium --dry-run >/dev/null 2>&1; then
  echo "[entrypoint] installing chromium for the current playwright version"
  "$apps_web_bin" install chromium || echo "[entrypoint] chromium install failed; /og/share.png will 503"
fi

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
# Self-hosted docs (no build step — plain node server.ts); coyo routes docs-pr-<n> here.
cd /repo/apps/docs
HOST=0.0.0.0 PORT="$DOCS_PORT" node server.ts &

trap 'kill 0' TERM INT
wait -n
# First child to exit takes the env down with it — a half-dead env is worse than none.
kill 0
exit 1

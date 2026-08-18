set -euo pipefail
cd ~/boardgamers-mono

echo ":: pulling latest code"
git fetch origin main
git reset --hard origin/main

echo ":: installing dependencies"
CI=true pnpm install --frozen-lockfile

# The OG share-image renderer (apps/web /share.webp/*) drives Chromium via Playwright.
# `pnpm install` does not fetch the browser, so install it here — user-level only
# (no --with-deps: that runs sudo, which can't work non-interactively over SSH and
# would abort this `set -e` script). It lands in the default PLAYWRIGHT_BROWSERS_PATH
# (~/.cache/ms-playwright), which the PM2 web process reads. OS-level deps are a
# one-time root step done out-of-band on the host:
#   sudo pnpm --filter @bgs/web exec playwright install-deps chromium
# The renderer degrades gracefully: /share.webp/* 503s until browser+deps are present,
# and the rest of the site keeps running — so never fail the deploy over this.
echo ":: installing Playwright Chromium (OG share-image renderer)"
pnpm --filter @bgs/web exec playwright install chromium ||
  echo ":: WARNING: Chromium install failed — /share.webp/* will 503 until browser+deps are present (see comment above)"

echo ":: building web (SvelteKit SSR)"
# Build into a temp dir so the live build/ is never half-written.
WEB_ADAPTER_OUT=build-new pnpm --filter @bgs/web build

# Keep immutable chunks from recent builds for ~30 days: clients with an
# already-loaded page still reference old hashed filenames, and deleting them
# breaks client-side navigation until a refresh. Files under _app/immutable are
# content-hashed, so a same-named carry-over is byte-identical. build-old (the
# pre-swap build) is copied first because it accumulated chunks from earlier
# deploys; cp -n never overwrites, so duplicates are skipped. cp -p preserves
# mtimes so the age-based pruning below measures from the chunk's first build,
# not its last copy.
for prev in apps/web/build-old apps/web/build; do
  if [ -d "$prev/client/_app/immutable" ]; then
    cp -prn "$prev/client/_app/immutable/." apps/web/build-new/client/_app/immutable/
  fi
done
find apps/web/build-new/client/_app/immutable -type f -mtime +30 -delete

# Atomically swap the new build into place, then reload PM2.
# PM2 runs index.js from cwd ./apps/web/build in cluster mode,
# so reload picks up the new files with zero downtime.
rm -rf apps/web/build-old
if [ -d apps/web/build ]; then mv apps/web/build apps/web/build-old; fi
mv apps/web/build-new apps/web/build
rm -rf apps/web/build-old

echo ":: building admin (SPA)"
# Same pattern: build to a temp dir, then atomically swap.
# Nginx serves admin from dist/ directly (no PM2), so the swap
# is the only protection against a half-written directory.
ADMIN_ADAPTER_OUT=dist-new pnpm --filter @bgs/admin build

# Same immutable-chunk retention as the web app (nginx serves dist/ directly).
for prev in apps/admin/dist-old apps/admin/dist; do
  if [ -d "$prev/_app/immutable" ]; then
    cp -prn "$prev/_app/immutable/." apps/admin/dist-new/_app/immutable/
  fi
done
find apps/admin/dist-new/_app/immutable -type f -mtime +30 -delete

rm -rf apps/admin/dist-old
if [ -d apps/admin/dist ]; then mv apps/admin/dist apps/admin/dist-old; fi
mv apps/admin/dist-new apps/admin/dist
rm -rf apps/admin/dist-old

echo ":: reloading PM2 processes"
# Picks up the new `docs` app (apps/docs/server.ts) on first deploy after this merge.
pm2 reload ecosystem.config.cjs

# Grafana provisions dashboards at startup only (no file watching).
# Restart it so the updated bgs-health.json is picked up.
# Promtail auto-reloads via watchConfig, no restart needed.
if podman container exists bgs-grafana; then
  echo ":: restarting grafana (dashboard re-provisioning)"
  podman restart bgs-grafana
fi

echo ":: deploy complete"

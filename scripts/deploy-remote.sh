set -euo pipefail
cd ~/boardgamers-mono

# Serialize deploys: several PRs merged back-to-back trigger one deploy job each,
# and concurrent runs of this script race each other (shared checkout, build-dir
# swaps — the 2026-08-25 blank-site incident). Abort rather than queue: every
# run deploys origin/main's tip, so the loser can simply be re-triggered (or the
# next merge's deploy covers it). The workflow-side `concurrency` group already
# dedupes queued runs; this lock is the belt-and-braces for anything that slips
# through (e.g. manual runs).
#
# The lock is held by a detached `flock` process (setsid), NOT by this shell:
# `exec 9>lock; flock 9` leaks the fd to every child this script spawns, and a
# daemon among them (the `podman restart bgs-grafana` below leaked it into
# rootlessport/conmon) then holds the lock forever, aborting all later deploys.
# A detached flock holds it for exactly this script's lifetime and releases it
# when killed at exit — children never see the fd.
#
# Exception: if this script is SIGKILLed (OOM, `kill -9`), the EXIT trap can't
# run and the detached flock would hold the lock forever. Recover with:
#   ssh coyo 'sudo su - bgs -c "pkill -f \"flock -n /tmp/bgs-deploy.lock\""'
# (SIGTERM/SIGINT — including runner timeout/cancel — do run the trap.)
echo ":: acquiring deploy lock"
setsid flock -n /tmp/bgs-deploy.lock sleep infinity </dev/null >/dev/null 2>&1 &
LOCK_PID=$!
disown
# Give flock a moment to either acquire or fail (a contended flock -n fails in
# ~30ms, so 1s is ample).
sleep 1
if ! kill -0 "$LOCK_PID" 2>/dev/null; then
	echo "::error:: another deploy is already running (lock /tmp/bgs-deploy.lock held) — aborting; re-run once it finishes"
	exit 1
fi
# Release the lock however this script exits (success, error, signal). The lock
# is held by both the flock process and its `sleep` child, so kill the whole
# process group (setsid made LOCK_PID the group leader) — killing flock alone
# would leave the child holding the lock.
release_lock() {
	kill -- -"$LOCK_PID" 2>/dev/null || true
}
trap release_lock EXIT

echo ":: pulling latest code"
# The deploy must fetch from the forge that triggered it. REPO_URL is passed by
# the workflow (github.server_url + github.repository); if the checkout's origin
# still points at the old forge (Codeberg→GitHub move), flip it so we don't
# deploy stale code.
if [ -n "${REPO_URL:-}" ]; then
  CURRENT_ORIGIN=$(git remote get-url origin 2>/dev/null || true)
  case "$CURRENT_ORIGIN" in
    "$REPO_URL" | "$REPO_URL.git") ;;
    *)
      echo ":: origin is '$CURRENT_ORIGIN', expected '$REPO_URL' — repointing"
      git remote set-url origin "$REPO_URL"
      ;;
  esac
fi
git fetch origin main
# Save the pre-deploy commit for rollback guidance if the smoke check fails.
# (ORIG_HEAD is unreliable here: pnpm install can run git operations — e.g.
# dep patching — that overwrite it; a plain reset --hard does not set it.)
PREV_COMMIT=$(git rev-parse HEAD)
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

# Carry immutable chunks from previous builds into the new build dir.
# $1: previous build's immutable dir, $2: new build's immutable dir.
#
# Same-named files are normally byte-identical (content-hashed), but that
# assumption broke once: a rollback rebuilt a chunk with the same name and
# different content, and `cp -n` kept the poisoned file from the broken build
# (2026-08-25 incident, #421/#422). So on a name collision, cmp the files and
# the NEW build always wins.
#
# Identical old files are still copied over (cp -p keeps the original mtime, so
# the 30-day pruning below ages chunks from their first build, not last copy),
# because the content-hash makes no freshness guarantee: the #421/#422 rollback
# produced SAME-name SAME-content chunks a few seconds apart, and keeping only
# the new one would have reset a still-referenced chunk's 30-day clock.
deploy_carry_over_immutable() {
  local prev="$1" dest="$2" f rel
  [ -d "$prev" ] || return 0
  find "$prev" -type f | while read -r f; do
    rel="${f#"$prev"/}"
    if [ ! -e "$dest/$rel" ]; then
      mkdir -p "$(dirname "$dest/$rel")"
      cp -p "$f" "$dest/$rel"
    elif ! cmp -s "$f" "$dest/$rel"; then
      echo ":: WARNING: chunk '$rel' exists in the new build with different content — keeping the new build's file (see #421/#422)"
    else
      cp -p "$f" "$dest/$rel"
    fi
  done
}

echo ":: building web (SvelteKit SSR)"
# Build into a temp dir so the live build/ is never half-written.
WEB_ADAPTER_OUT=build-new pnpm --filter @bgs/web build

# Keep immutable chunks from recent builds for ~30 days: clients with an
# already-loaded page still reference old hashed filenames, and deleting them
# breaks client-side navigation until a refresh. build-old (the pre-swap build)
# is carried over first because it accumulated chunks from earlier deploys.
deploy_carry_over_immutable apps/web/build-old/client/_app/immutable apps/web/build-new/client/_app/immutable
deploy_carry_over_immutable apps/web/build/client/_app/immutable apps/web/build-new/client/_app/immutable
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
deploy_carry_over_immutable apps/admin/dist-old/_app/immutable apps/admin/dist-new/_app/immutable
deploy_carry_over_immutable apps/admin/dist/_app/immutable apps/admin/dist-new/_app/immutable
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

# --- Post-deploy smoke check -------------------------------------------------
# Prod-only script, so the prod URLs are hardcoded. The build swap already
# happened above: a failure here leaves the new build live but turns the
# deploy job red, and prints rollback guidance.
#
# Why: a poisoned/missing client chunk once survived a rollback and kept being
# served (2026-08-25, #421/#422). Fetching / plus the entry chunks it points to
# catches that class of breakage at the source.

# $1: URL. Prints body on stdout on HTTP 200; returns 1 otherwise.
deploy_fetch_ok() {
  local url="$1" out code
  out=$(mktemp)
  code=$(curl -sS -o "$out" -w '%{http_code}' --max-time 15 "$url") || {
    echo "::error::curl failed for $url"
    rm -f "$out"
    return 1
  }
  if [ "$code" != 200 ]; then
    echo "::error::HTTP $code for $url (expected 200)"
    rm -f "$out"
    return 1
  fi
  cat "$out"
  rm -f "$out"
}

# $1: site base URL, $2: min bytes for a non-trivial / body, $3: label.
deploy_smoke_check() {
  local base="$1" min_bytes="$2" label="$3"
  local html size path chunk_size

  if ! html=$(deploy_fetch_ok "$base/"); then
    echo "::error::$label: smoke check FAILED — cannot fetch $base/"
    return 1
  fi
  size=${#html}
  if [ "$size" -lt "$min_bytes" ]; then
    echo "::error::$label: / body is suspiciously small ($size bytes < $min_bytes)"
    return 1
  fi

  # Entry chunks boot the client; the SSR HTML references them as
  # "/_app/immutable/entry/<file>.js" (admin) or "./_app/..." (web).
  local chunks
  # `|| true`: grep exits 1 on no match, which would kill the script under
  # `set -e` if this is ever called outside a condition guard.
  chunks=$(printf '%s' "$html" | grep -oE '(\./)?/_app/immutable/entry/[^"'"'"' )]*\.js' | sed 's|^\./||' | sort -u || true)
  if [ -z "$chunks" ]; then
    echo "::error::$label: no /_app/immutable/entry/*.js chunks found in / HTML"
    return 1
  fi

  local failed=0
  for path in $chunks; do
    local body
    if ! body=$(deploy_fetch_ok "$base$path"); then
      echo "::error::$label: entry chunk $path is not served"
      failed=1
      continue
    fi
    # No lower size bound beyond non-empty: SvelteKit's start.*.js entry is a
    # legitimately tiny (~80 bytes) re-export shim.
    chunk_size=${#body}
    if [ "$chunk_size" -eq 0 ]; then
      echo "::error::$label: entry chunk $path is empty"
      failed=1
    fi
  done
  [ "$failed" -eq 0 ] || return 1
  echo ":: $label smoke check OK (/ = $size bytes, $(printf '%s\n' "$chunks" | wc -l) entry chunks)"
}

SMOKE_FAILED=0

# Wait for the reloaded web process to serve (pm2 reload is graceful; the new
# workers can take a few seconds to come up).
echo ":: smoke check: waiting for https://boardgamers.space/ to come up"
web_up=0
for _ in $(seq 1 6); do
  if code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://boardgamers.space/) && [ "$code" = 200 ]; then
    web_up=1
    break
  fi
  sleep 5
done
if [ "$web_up" -ne 1 ]; then
  echo "::error::web: https://boardgamers.space/ did not return HTTP 200 within ~30s of pm2 reload"
  SMOKE_FAILED=1
else
  deploy_smoke_check https://boardgamers.space 1000 web || SMOKE_FAILED=1
fi

# Admin is nginx-served static files (no process to wait for).
deploy_smoke_check https://admin.boardgamers.space 500 admin || SMOKE_FAILED=1

if [ "$SMOKE_FAILED" -ne 0 ]; then
  cat <<EOF
::error::================ POST-DEPLOY SMOKE CHECK FAILED ================
::error::The new build IS already live (the swap + pm2 reload happened before
::error::this check). Investigate the errors above. To roll back:
::error::  ssh bgs 'cd ~/boardgamers-mono && git checkout $PREV_COMMIT && bash scripts/deploy-remote.sh'
::error::(that re-runs the deploy from the previous commit, $PREV_COMMIT)
EOF
  exit 1
fi

echo ":: deploy complete"

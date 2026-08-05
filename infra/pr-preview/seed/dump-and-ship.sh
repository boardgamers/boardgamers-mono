#!/usr/bin/env bash
# Nightly on coyo, bgs crontab (no cross-db writes needed — scrub is client-side):
#   17 3 * * * /home/bgs/boardgamers-mono/infra/pr-preview/seed/dump-and-ship.sh >> /tmp/bgs-seed.log 2>&1
#
# Exports the prod bgs db minus user-identifying collections; `users` is dumped
# with everything else, then rebuilt client-side from a whitelist of safe fields
# (see scrub-users.mjs — whitelist, so new sensitive schema fields are dropped by
# default). Ships the result to the minipc over WireGuard and refreshes the live
# bgs-preview-template db via preview-api.
#
# PR envs restore from this template and never touch the live db
# (issue #120: "replicate, don't share").
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HOME/boardgamers-mono"
MINIPC="coyotte508@10.90.0.2"
SSH="ssh -i $HOME/.ssh/bgs-seed"
WORK="$(mktemp -d /tmp/bgs-seed.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

dbUrl="$(grep -E '^dbUrl=' "$REPO/apps/api/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"'\r')"
MONGO_TOOLS="${dbUrl%/admin}"

# Collections to exclude entirely (sessions, tokens, private comms, cron state).
EXCLUDED=(usersettings locks chats notifications sessions jwtrefreshtokens)
EXCLUDE_ARGS=()
for c in "${EXCLUDED[@]}"; do EXCLUDE_ARGS+=(--excludeCollection "$c"); done

mongodump --uri="$MONGO_TOOLS" --authenticationDatabase admin --db bgs --out "$WORK/dump" "${EXCLUDE_ARGS[@]}"

# Assemble the template: everything public + scrubbed users.
mkdir -p "$WORK/template/bgs-preview-template"
for f in "$WORK"/dump/bgs/*.bson "$WORK"/dump/bgs/*.metadata.json; do
  base="$(basename "$f")"
  case "$base" in users.*) continue;; esac
  cp "$f" "$WORK/template/bgs-preview-template/"
done
cp "$WORK"/dump/bgs/users.metadata.json "$WORK/template/bgs-preview-template/"
echo "scrubbing users"
STORE="$(ls -d "$REPO"/node_modules/.pnpm/mongodb@*/node_modules/mongodb/lib/index.js | head -1)"
echo "mongodb driver: $STORE"
MONGODB_STORE="$STORE" node "$HERE/scrub-users.mjs" \
  < "$WORK/dump/bgs/users.bson" \
  > "$WORK/template/bgs-preview-template/users.bson"
echo "scrubbed: $(wc -c < "$WORK/template/bgs-preview-template/users.bson") bytes (from $(wc -c < "$WORK/dump/bgs/users.bson"))"

$SSH "$MINIPC" 'rm -rf ~/bgs-previews/dumps/template.new && mkdir -p ~/bgs-previews/dumps/template.new'
scp -i "$HOME/.ssh/bgs-seed" -r "$WORK/template/bgs-preview-template" "$MINIPC":~/bgs-previews/dumps/template.new/
$SSH "$MINIPC" '
  set -e
  rm -rf ~/bgs-previews/dumps/template.old
  [ -d ~/bgs-previews/dumps/template ] && mv ~/bgs-previews/dumps/template ~/bgs-previews/dumps/template.old || true
  mv ~/bgs-previews/dumps/template.new ~/bgs-previews/dumps/template
  curl -sf -X POST -H "Authorization: Bearer $(cat ~/.config/bgs-preview/secret)" http://10.90.0.2:9900/seed
'

echo "seed shipped at $(date -Is)"

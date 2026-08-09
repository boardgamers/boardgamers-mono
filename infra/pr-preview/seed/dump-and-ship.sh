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

# Collections to exclude entirely. Private: sessions, tokens, private comms, cron
# state. Debug/transient bulk that previews don't need: apierrors, logs,
# gamenotifications (~25 MB). deletedUsers is the soft-delete archive — it holds
# full user docs (emails etc.) and must never reach preview dumps. And games is
# dumped separately below with a status filter (open+active only), because 99% of
# it is 2.8 GB of ended games.
EXCLUDED=(
  usersettings locks chats notifications sessions jwtrefreshtokens admintokens
  apierrors logs gamenotifications deletedUsers
  games
)
EXCLUDE_ARGS=()
for c in "${EXCLUDED[@]}"; do EXCLUDE_ARGS+=(--excludeCollection "$c"); done

mongodump --uri="$MONGO_TOOLS" --authenticationDatabase admin --db bgs --out "$WORK/dump" "${EXCLUDE_ARGS[@]}"

# Games: open + active, plus the most recent ~1000 ended games so rankings/history
# look real in previews (~1500 docs, ~60 MB) instead of all 51k (~2.8 GB). "Recent"
# is by lastMove (indexed, time-ordered); games._id is a string slug, not an
# ObjectId, so it can't be used for ordering. Metadata (indexes) comes along.
LAST_ENDED_MOVE=$(mongosh --quiet "$dbUrl" --eval '
  const g = db.getSiblingDB("bgs").games
    .find({ status: "ended", lastMove: { $type: "date" } }, { lastMove: 1 })
    .sort({ lastMove: -1 }).skip(999).limit(1).toArray()[0];
  print(g ? g.lastMove.toISOString() : "");
')
if [ -n "$LAST_ENDED_MOVE" ]; then
  GAMES_QUERY="{\"\$or\":[{\"status\":{\"\$in\":[\"open\",\"active\"]}},{\"status\":\"ended\",\"lastMove\":{\"\$gte\":{\"\$date\":\"$LAST_ENDED_MOVE\"}}}]}"
else
  GAMES_QUERY='{"status":{"$in":["open","active"]}}'
fi
mongodump --uri="$MONGO_TOOLS" --authenticationDatabase admin --db bgs \
  --collection games --query "$GAMES_QUERY" --out "$WORK/dump"

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

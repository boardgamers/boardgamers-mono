#!/usr/bin/env bash
# Test for the first-boot seed guard (db-needs-seed.sh). Needs mongosh + a MongoDB
# to talk to; a scratch mongod is started on a tmpdir unless MONGO_URL is given.
#
#   ./db-needs-seed.spec.sh
#
# Skips cleanly (exit 0) when mongosh/mongod aren't installed.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v mongosh >/dev/null 2>&1; then
  echo "1..0 # SKIP mongosh not installed"
  exit 0
fi

MONGO_URL="${MONGO_URL:-}"
MONGOD_PID=""
TMPDIR_TEST=""
cleanup() {
  [ -n "$MONGOD_PID" ] && kill "$MONGOD_PID" 2>/dev/null || true
  [ -n "$TMPDIR_TEST" ] && rm -rf "$TMPDIR_TEST" || true
  return 0
}
trap cleanup EXIT

if [ -z "$MONGO_URL" ]; then
  if ! command -v mongod >/dev/null 2>&1; then
    echo "1..0 # SKIP mongod not installed and MONGO_URL not set"
    exit 0
  fi
  TMPDIR_TEST="$(mktemp -d)"
  mongod --dbpath "$TMPDIR_TEST" --port 27999 --bind_ip 127.0.0.1 --nojournal --quiet --fork --logpath "$TMPDIR_TEST/mongod.log"
  MONGO_URL="mongodb://127.0.0.1:27999"
fi

DB="bgs-pr-test-seed-$$"

eval_js() { DB_NAME="$DB" mongosh --quiet "$MONGO_URL" --eval "$1" >/dev/null; }

t=0
ok() { t=$((t + 1)); if [ "$2" = "$3" ]; then echo "ok $t - $1"; else echo "not ok $t - $1 (want $3, got $2)"; exit 1; fi; }

# 1. missing db -> seed
ok "missing db seeds" "$(./db-needs-seed.sh "$MONGO_URL" "$DB")" yes

# 2. db with only an empty collection -> seed
eval_js 'db.getSiblingDB(process.env.DB_NAME).createCollection("users")'
ok "empty users collection seeds" "$(./db-needs-seed.sh "$MONGO_URL" "$DB")" yes

# 3. db with users docs -> keep
eval_js 'db.getSiblingDB(process.env.DB_NAME).users.insertOne({name: "x"})'
ok "non-empty users collection keeps" "$(./db-needs-seed.sh "$MONGO_URL" "$DB")" no

# 4. db with only gameinfos docs -> keep
DB_B="${DB}-b"
eval_js 'db.getSiblingDB(process.env.DB_NAME).dropDatabase()'
DB="$DB_B" eval_js 'db.getSiblingDB(process.env.DB_NAME).gameinfos.insertOne({game: "x"})'
ok "non-empty gameinfos collection keeps" "$(./db-needs-seed.sh "$MONGO_URL" "$DB_B")" no

# 5. mongo unreachable -> keep (fail safe: never wipe what we can't inspect)
DB="$DB_B" ./db-needs-seed.sh "mongodb://127.0.0.1:1" "$DB_B" >/dev/null 2>&1 || true
ok "unreachable mongo keeps" "$(DB="$DB_B"; ./db-needs-seed.sh "mongodb://127.0.0.1:1" "$DB_B")" no

eval_js 'db.getSiblingDB(process.env.DB_NAME).dropDatabase()' || true
DB="$DB_B" eval_js 'db.getSiblingDB(process.env.DB_NAME).dropDatabase()' || true

echo "1..$t"

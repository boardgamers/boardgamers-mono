#!/usr/bin/env bash
# First-boot guard for the preview entrypoint: prints "yes" when the env db has no
# app data yet (fresh env → seed from the template), "no" when it does (container
# restart / code update → keep the existing data).
#
#   db-needs-seed.sh <mongoUrl> <dbName>
#
# Exit 0 always (2 on bad args); the decision is the stdout word. Mongo being
# unreachable counts as "don't wipe": if we can't tell, we must not drop data —
# the entrypoint's ping wait beforehand makes that case unlikely anyway.
set -u

MONGO_URL="${1:?usage: db-needs-seed.sh <mongoUrl> <dbName>}"
DB="${2:?usage: db-needs-seed.sh <mongoUrl> <dbName>}"

OUT="$(
  DB_NAME="$DB" mongosh --quiet "$MONGO_URL" --eval '
    const db = db.getSiblingDB(process.env.DB_NAME);
    const names = new Set(db.getCollectionNames());
    const has = (n) => names.has(n) && db.getCollection(n).estimatedDocumentCount() > 0;
    print(has("users") || has("gameinfos") ? "no" : "yes");
  ' 2>/dev/null | tail -n 1
)"

# Fail safe: anything that isn't a clear "yes" means don't reseed.
if [ "$OUT" = "yes" ]; then
  echo yes
else
  echo no
fi

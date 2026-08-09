#!/usr/bin/env bash
# wait-copilot-review.sh <PR#> [sinceISO]
# Waits for the in-flight Copilot review on PR <PR#> to finish (every
# copilot_work_started has a matching Copilot `reviewed`), then prints Copilot's
# inline review comments created at/after [sinceISO] ("CLEAN" if none).
#   git push; NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ); bash scripts/wait-copilot-review.sh <PR> "$NOW"
# Requires gh only (uses its built-in --jq; no external jq on this box).
set -euo pipefail
PR="$1"; SINCE="${2:-1970-01-01T00:00:00Z}"
REPO="boardgamers/boardgamers-mono"
TL="repos/$REPO/issues/$PR/timeline?per_page=100"

for i in $(seq 1 48); do
  p=$(gh api "$TL" --jq '[.[]|select(.event=="copilot_work_started")]|length')
  d=$(gh api "$TL" --jq '[.[]|select(.event=="reviewed" and .user.login=="Copilot")]|length')
  if [ "${p:-0}" -gt 0 ] && [ "${d:-0}" -ge "${p:-0}" ]; then break; fi
  sleep 15
done

gh api "repos/$REPO/pulls/$PR/comments?per_page=100" \
  --jq '[.[]|select(.user.login=="Copilot" and .created_at >= "'"$SINCE"'")]|sort_by(.created_at)|if length==0 then "CLEAN" else .[]|"[\(.path):\(.line // .original_line)]\n\(.body)\n---" end'

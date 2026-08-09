#!/usr/bin/env bash
# wait-copilot-review.sh <PR#> [sinceISO]
# Waits for the in-flight Copilot review on PR <PR#> to finish (every
# copilot_work_started has a matching Copilot `reviewed`), then prints:
#   1. NEW inline review comments (Copilot) created at/after [sinceISO], AND
#   2. any "Suppressed comments" section from the LATEST Copilot review body
#      (real suggestions Copilot collapsed — do NOT ignore them).
# CLEAN means: no new inline comments AND no suppressed comments.
#   git push; NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ); bash scripts/wait-copilot-review.sh <PR> "$NOW"
# Requires gh only (built-in --jq; no external jq on this box).
# Gotchas baked in: gh api has NO --arg (string-substitute instead), avoid
# --paginate (breaks on this gh version). Author login differs by endpoint:
# timeline `reviewed` events use "Copilot"; the pulls reviews/comments API uses
# "copilot-pull-request-reviewer[bot]" — so match case-insensitively with (?i)copilot.
set -euo pipefail
PR="$1"; SINCE="${2:-1970-01-01T00:00:00Z}"
REPO="boardgamers/boardgamers-mono"
TL="repos/$REPO/issues/$PR/timeline?per_page=100"

for i in $(seq 1 48); do
  p=$(gh api "$TL" --jq '[.[]|select(.event=="copilot_work_started")]|length')
  d=$(gh api "$TL" --jq '[.[]|select(.event=="reviewed" and ((.user.login//"")|test("(?i)copilot")))]|length')
  if [ "${p:-0}" -gt 0 ] && [ "${d:-0}" -ge "${p:-0}" ]; then break; fi
  sleep 15
done

echo "=== inline comments since $SINCE ==="
gh api "repos/$REPO/pulls/$PR/comments?per_page=100" \
  --jq '[.[]|select(((.user.login//"")|test("(?i)copilot")) and (.created_at >= "'"$SINCE"'"))]|sort_by(.created_at)|if length==0 then "none" else .[]|"[\(.path):\(.line // .original_line)]\n\(.body)\n---" end'

echo "=== suppressed comments in latest Copilot review ==="
gh api "repos/$REPO/pulls/$PR/reviews?per_page=100" \
  --jq '[.[]|select((.user.login//"")|test("(?i)copilot"))]|sort_by(.submitted_at)|last|.body as $b
        | if ($b|test("Suppressed comments")) then
            ($b|capture("(?s)<summary>Suppressed comments.*?</summary>(?<s>.*?)</details>").s | gsub("^\\s+|\\s+$";""))
          else "none" end'

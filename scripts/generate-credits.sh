#!/usr/bin/env bash
# Generates source/commands/contributors.json from git history.
# Run automatically as part of `pnpm run build`.

set -euo pipefail

OUT="source/commands/contributors.json"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repo — skipping contributors generation"
  exit 0
fi

git log --format="%aN" \
  | sort -u \
  | grep -v '\[bot\]' \
  | grep -v '^GitHub Action$' \
  | grep -v '^Claude$' \
  | grep -v '^Researcher$' \
  | jq -R . \
  | jq -s '{ contributors: . }' \
  > "$OUT"

# Format to match biome settings (tabs, trailing commas, etc.)
npx biome format --write "$OUT" 2>/dev/null || true

echo "Generated $OUT with $(jq '.contributors | length' "$OUT") contributors"

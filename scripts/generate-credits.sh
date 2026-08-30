#!/usr/bin/env bash
# Generates source/commands/contributors.json from git history.
# Run automatically as part of `pnpm run build`.

set -euo pipefail

OUT="source/commands/contributors.json"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repo — skipping contributors generation"
  exit 0
fi

# `grep -v` exits 1 when it filters out every line (e.g. a shallow clone whose
# only commit is authored by a bot), which pipefail would turn into a hard
# failure — hence the `|| true`.
git log --format="%aN" \
  | sort -u \
  | { grep -Ev '\[bot\]|^(GitHub Action|Claude|Researcher)$' || true; } \
  | jq -R . \
  | jq -s '{ contributors: . }' \
  > "$OUT"

# Format to match biome settings (tabs, trailing commas, etc.)
npx biome format --write "$OUT" 2>/dev/null || true

echo "Generated $OUT with $(jq '.contributors | length' "$OUT") contributors"

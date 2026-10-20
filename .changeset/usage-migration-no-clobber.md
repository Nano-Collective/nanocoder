---
"@nanocollective/nanocoder": patch
---

Fixed a race in the one-time `usage.json` legacy migration: two processes migrating at once could let the loser paste its stale copy over the winner's fresher file (via the `renameSync` copy fallback). Migration now publishes with a temp file plus an atomic hard link that raises `EEXIST` when a peer won, adopting the existing file untouched instead of overwriting it.

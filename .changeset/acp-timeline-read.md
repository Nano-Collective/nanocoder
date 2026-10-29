---
"@nanocollective/nanocoder": minor
---

Add a read-only `_nanocoder/timeline/read` ACP method that returns a file's before-image for a timeline checkpoint (`text`, `created` or `unavailable`), and report `createdFiles` and a per-prompt `turnId` in `_nanocoder/timeline/list` entries. `truncateToMessageIndex` changes with every model round-trip, so `turnId` is what groups the checkpoints of one prompt; checkpoints recorded before this change have no `turnId`.

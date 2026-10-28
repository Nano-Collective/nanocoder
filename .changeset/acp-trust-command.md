---
"@nanocollective/nanocoder": minor
---

Clients can now check and grant directory trust without `--trust-directory`. `nanocoder trust --status [--json]` reports whether the folder is trusted (`trusted`, `not-trusted`, `changed` or `needs-re-approval`), what it will run and its fingerprint, and loads nothing from the folder. `nanocoder trust --grant <fingerprint>` saves the folder only if its fingerprint still matches, so a client can save exactly what it showed the user. `nanocoder --acp` now exits with code `3` when it refuses an untrusted folder, instead of `1`, which other startup failures still use. Each trust entry also records a fingerprint version, so an entry saved by another version reads as needing re-approval instead of changed.

---
"@nanocollective/nanocoder": patch
---

`/review` now runs a grounded review: a read-only agent investigates the pinned revision under a fixed tool budget, every issue must cite `file:line` in the changed code, and an independent verifier re-checks each one before it is reported. Budget, coverage, and verification gaps are reported as an incomplete review rather than a clean one. A live activity view (`d` details, `Esc` cancel) shows progress, the report and its activity summary are saved with the session, and `/review activity` shows the latest trace. `/review quick` keeps the one-shot diff review. Part of #1287.

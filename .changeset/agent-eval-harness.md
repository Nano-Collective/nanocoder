---
'@nanocollective/nanocoder': minor
---

Added an agent evaluation harness under `benchmarks/agent/`, run with `pnpm run test:agent-eval`. It measures pass/fail, steps, tokens and cost per task by shelling out to `nanocoder --plain --json run`, so a released tag can be measured with the same harness as the working tree. Six vendored task fixtures each carry machine-checkable assertions and distractor files, so a run working from degraded context fails rather than merely finishing cheaper; every result records the fixture-set id and a content hash of the fixtures. It is deliberately outside `pnpm run test:all`, since it needs real model calls. Phase 0 of #1197.

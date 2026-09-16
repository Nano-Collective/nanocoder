---
"@nanocollective/nanocoder": minor
---

Adds an opt-in `build:fast` script powered by Rolldown that bundles first-party source for a faster CLI cold start. Runtime dependencies stay external and the bundle is code-split under `dist/`. The default `build` script (`tsc + tsc-alias`) is unchanged.

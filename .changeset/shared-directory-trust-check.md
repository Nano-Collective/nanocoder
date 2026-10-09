---
"@nanocollective/nanocoder": patch
---

The interactive directory-trust prompt now resolves trust through the same `isDirectoryTrusted` check as `--plain` and `nanocoder daemon start`, so the matching rule can no longer drift between entry points. Also corrects the `--trust-directory` warning, which now names `nanocoder daemon start` alongside `nanocoder run`. Closes #1339.

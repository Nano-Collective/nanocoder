---
"@nanocollective/nanocoder": patch
---

Reject git_diff bases starting with `-` so a model-supplied base can no longer smuggle git options such as `--output=<file>` into the read-only tool, and pass `--end-of-options` before the revision as defense in depth.

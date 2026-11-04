---
'@nanocollective/nanocoder': patch
---

`nanocoder --acp` now refuses a directory you haven't trusted, the same check `nanocoder run` makes, before it loads that directory's project config (providers, hooks, MCP servers). Trust the directory by running `nanocoder` interactively there once, set `NANOCODER_TRUST_DIRECTORY=1`, or pass `--trust-directory` for one run. The VS Code extension passes `--trust-directory` only when the workspace is trusted in VS Code's Workspace Trust, so it keeps working in folders you've trusted there.

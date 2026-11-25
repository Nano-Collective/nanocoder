---
"@nanocollective/nanocoder": minor
---

Add named configuration profiles (`nanocoder.profiles` and `nanocoder.defaultProfile` in `agents.config.json`). Profiles bundle provider, model, mode, and section overrides, selectable via `--profile <name>`, `NANOCODER_PROFILE`, or the `/profile` slash command in the TUI, and reported in `nanocoder config show` and `diff`.

---
'@nanocollective/nanocoder': minor
---

Add `nanocoder.formatters`: code formatters (Prettier, Biome, gofmt, ...) that run on every file the agent writes whose path matches a glob, before `post-tool-use` hooks fire. The model is told when a formatter changed the file so its next edit starts from what is on disk. Closes #1483.

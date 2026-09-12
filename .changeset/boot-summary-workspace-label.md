---
'@nanocollective/nanocoder': patch
---

Show the workspace, not a config path, in the startup summary.

The startup line used to print the directory of the closest `agents.config.json`, which is rarely where you are working and reads as noise. It now shows the directory Nanocoder is operating in, followed by the active branch when the workspace is a git repository. Narrow terminals keep the provider, model and mode on the first line and drop the workspace and branch underneath.

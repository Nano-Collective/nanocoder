---
"@nanocollective/nanocoder": patch
---

Fix the VS Code chat panel saying "Provider switched to X" or "Model switched to Y" even when the switch failed. The switch methods swallowed errors, so the success message showed when the agent was disconnected, had no session, or rejected the change. They now report the outcome: failures show an error with the reason, and a model switch that worked for the session but could not be saved as the default VS Code setting shows a warning saying so. Closes #1721.

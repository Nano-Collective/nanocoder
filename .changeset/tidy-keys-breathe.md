---
'@nanocollective/nanocoder': patch
---

The agent-eval runner now handles `--help` without starting a benchmark, rejects unknown options, loads fixtures in a stable order, and removes its temporary workspace when interrupted. Closes #1745.

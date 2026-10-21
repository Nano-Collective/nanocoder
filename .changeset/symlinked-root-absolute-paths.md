---
'@nanocollective/nanocoder': patch
---

File tools now accept an absolute path that reaches the project through a symlink, such as the real path of a project opened through a symlink, or `/tmp` vs `/private/tmp` on macOS. Paths that really sit outside the project are still rejected. Closes #1636.

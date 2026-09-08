---
'@nanocollective/nanocoder': patch
---

Quote custom tool template values for cmd.exe so spaces, command metacharacters, and embedded quotes stay literal on Windows. Values containing percent signs or command separators are rejected because cmd.exe cannot quote them reliably. Closes #1084.

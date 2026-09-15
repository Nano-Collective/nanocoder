---
'@nanocollective/nanocoder': patch
---

Quote custom tool template values for cmd.exe so spaces, command metacharacters, and embedded quotes stay literal on Windows. Values containing percent signs, newlines, or null bytes are rejected because cmd.exe cannot represent them safely in a command string. This is a deliberate cross-platform restriction: values accepted by POSIX shells may be rejected by cmd.exe. Closes #1084.

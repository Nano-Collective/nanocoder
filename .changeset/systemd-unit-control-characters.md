---
"@nanocollective/nanocoder": patch
---

- `nanocoder daemon install` now rejects control characters in systemd project paths and daemon commands before writing a unit, with a clear error in the terminal. It also keeps trailing path backslashes from continuing into the next directive and quotes custom executable paths. Spaces, percent signs and Unicode paths remain supported. Closes #2307.

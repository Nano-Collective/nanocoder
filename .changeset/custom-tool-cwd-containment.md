---
'@nanocollective/nanocoder': patch
---

Custom tool `cwd` now stays inside the project after symlink and `${VAR}` resolution. A `cwd` that really resolves outside the project - an absolute path, `${HOME}`, a `../` traversal, or an in-repo symlink pointing out - now fails the tool call with `Custom tool cwd escapes the project directory` rather than running the script somewhere unexpected. A missing `cwd` still falls back to the project root. Closes #1027.

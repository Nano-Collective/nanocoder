---
"@nanocollective/nanocoder": patch
---

`execute_bash` no longer refuses a command just because a quoted argument mentions one of its blocked patterns, so `grep "dd if=" build.log`, `grep -rn 'mkfs' docs/` and a commit message that names `chmod -R 000` now run (after the usual approval). Names that merely contain a pattern, such as `mkfsnotes.txt`, are no longer refused either. A quoted command name, a quoted redirect target such as `> "/dev/sda"`, and a quoted string passed to `bash -c`, `eval`, `ssh` or `xargs` are still checked. The docs now say plainly that this list guards against accidents and is not a security boundary.

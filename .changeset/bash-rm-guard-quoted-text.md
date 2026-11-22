---
"@nanocollective/nanocoder": patch
---

`execute_bash` no longer refuses a harmless command that only mentions `rm -rf /` or `rm -rf ~` inside a quoted argument, such as a commit message, an `echo` into a file, or a `grep` pattern. Quoted text is set aside only when every command on the line is one that treats it as text (`echo`, `printf`, `grep`, `rg` without `--pre`, `cd`, `git add`, `git commit`) and the line has no command substitution, here-string, process substitution or backslash. Everything else, including a pipe into a shell, `bash -c`, `su -c`, `env`, `sudo` and other prefixes, is checked as before.

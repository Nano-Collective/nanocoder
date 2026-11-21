---
"@nanocollective/nanocoder": patch
---

`execute_bash` no longer refuses a harmless command that only mentions `rm -rf /` or `rm -rf ~` inside a quoted argument, such as a commit message, an `echo` into a file, or a `grep` pattern. An `rm` in command position, a quoted target (`rm -rf "$HOME"`), a string handed to another shell (`bash -c "rm -rf /"`) and a command substitution inside double quotes are still refused.

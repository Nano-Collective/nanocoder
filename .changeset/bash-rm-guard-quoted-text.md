---
"@nanocollective/nanocoder": patch
---

`execute_bash` no longer refuses a harmless command that only mentions `rm -rf /` or `rm -rf ~` inside a quoted argument, such as a commit message, an `echo` into a file, or a `grep` pattern. Quoted text is set aside only when every command on the line is one that treats it as text (`echo`, `printf`, `grep`, `rg` without `--pre`, `cd`, `git add`, `git commit`) and the line has no command substitution, process substitution, heredoc or here-string, backslash, or `#` outside quotes. Everything else, including a pipe into a shell, `bash -c`, `su -c`, `env`, `sudo` and other prefixes, is checked as before. A line chained with a command outside that list, such as `git commit -m "..." && git push`, is also checked as before.

The guard against `mkfs`, `dd if=` and the other blocked patterns no longer sets quoted text aside when the line has a backslash, a heredoc or a `#` outside quotes. Before, a quote inside a comment or after a backslash could open a span that hid the next command from it, as in `echo # "`, then `mkfs /dev/sda` on the next line, then `echo "x"`.

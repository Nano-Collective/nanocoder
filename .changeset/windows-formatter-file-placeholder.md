---
"@nanocollective/nanocoder": patch
---

Formatter and hook commands written the documented way, like `npx biome format --write "$FILE"`, now work on Windows. `cmd.exe` expands `%FILE%`, not `$FILE`, so the formatter used to receive the literal text `$FILE` and the file was left unformatted without any error. On Windows, references to the path variables (`$FILE`, `$NANOCODER_FILE`, `$NANOCODER_CWD`, `$NANOCODER_SESSION_CWD`, and their `${VAR}` forms) are now rewritten to `%VAR%` before the command runs, and quoted when they were left unquoted. The path still reaches the shell only through the environment, never spliced into the command. A path that cmd.exe cannot quote safely (one containing `"` or a line break) makes the command fail to run instead of running it. POSIX behavior is unchanged. Closes #1688.

---
"@nanocollective/nanocoder": minor
---

`nanocoder run` now reads piped stdin, so `git diff | nanocoder run "write a commit message"` and `npm test 2>&1 | nanocoder run "why did this fail"` work. The piped text is appended to the prompt in a `<stdin>` block, or is the prompt when none is given (which also replaces the "needs a prompt" error for a pipe). `--prompt-file -` reads the prompt from stdin explicitly, and works on Windows where `/dev/stdin` does not exist. At most 100,000 characters are read; a longer pipe is cut with a visible note. `run` waits for stdin to close whenever it is not a terminal, so scripts that launch it with an open pipe must close it; the agent-eval harness now does, and the docs cover piping.

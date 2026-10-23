---
"@nanocollective/nanocoder": minor
---

Added the Agentic CI/CD Gate: Nanocoder can now review pull requests and investigate (and optionally fix) CI failures without an interactive session.

- `git_pr` gains `diff`, `comment`, `review`, `checks` and `logs` actions (CI run logs support search and pagination).
- `nanocoder verify --pr <n> [--post-review]` runs a headless, read-only review with a semgrep pass over the PR's changed files, printing it or posting it as a PR comment. It refuses an untrusted directory (`--trust-directory` bypasses this for one run), and its reviewer can never comment, review or open PRs itself, whatever `alwaysAllow` says.
- The per-project daemon can watch GitHub Actions for failures (`ciWatch` in your global preferences, requires the `gh` CLI), run a read-only `verify-ci-investigator` subagent, post the diagnosis to the branch's PR, and send OS notifications. Skills can react to failures too with a new `ci.job.failed` trigger (optional `branches` filter).
- `nanocoder daemon start --trust <comment-only|auto-fix|full-commit>` (or `nanocoder.verify.trustLevel` in `agents.config.json`) lets the investigator fix the failure in an isolated clone: `auto-fix` pushes a new branch and opens a draft PR; `full-commit` pushes straight to the failing branch after a one-time per-project confirmation. A failure on a commit the daemon itself pushed as a fix is never fixed a second time, and `full-commit` confirmation and `ciWatch` are only read from your global preferences, never from a project file.

Safety notes:

- At `auto-fix` and `full-commit`, the fix run starts without GitHub tokens, gh login, ssh-agent or git credential helpers, reads the failed-step log the daemon fetched for it, and cannot push; the daemon publishes the result from the clone to the project's own `origin`.
- `verify` and CI investigations always use the built-in `verify-pr-review` and `verify-ci-investigator` agents, so a pull request cannot supply its own reviewer.
- Anything posted to GitHub passes through a secret-redaction step first, and semgrep receives the changed paths after `--`.
- A `verify.trustLevel` of `auto-fix` or `full-commit` in `agents.config.json` needs confirmation at `daemon start`; unattended starts, including the installed service, fall back to `comment-only`. `--trust=<level>` is accepted, `daemon status` shows the running level, and starting with a different level while a daemon runs says it was not applied.
- CI watch keeps polling after unexpected errors (minimum interval 5 seconds), and its state file is git-ignored.

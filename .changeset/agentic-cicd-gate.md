---
"@nanocollective/nanocoder": minor
---

Added the Agentic CI/CD Gate: Nanocoder can now review pull requests and investigate (and optionally fix) CI failures without an interactive session.

- `git_pr` gains `diff`, `comment`, `review`, `checks` and `logs` actions (CI run logs support search and pagination).
- `nanocoder verify --pr <n> [--post-review]` runs a headless, read-only review with a semgrep pass over the PR's changed files, printing it or posting it as a PR comment. It refuses an untrusted directory (`--trust-directory` bypasses this for one run), and its reviewer can never comment, review or open PRs itself, whatever `alwaysAllow` says.
- The per-project daemon can watch GitHub Actions for failures (`ciWatch` in your global preferences, requires the `gh` CLI), run a read-only `verify-ci-investigator` subagent, post the diagnosis to the branch's PR, and send OS notifications. Skills can react to failures too with a new `ci.job.failed` trigger (optional `branches` filter).
- `nanocoder daemon start --trust <comment-only|auto-fix|full-commit>` (or `nanocoder.verify.trustLevel` in `agents.config.json`) lets the investigator fix the failure in an isolated clone: `auto-fix` pushes a new branch and opens a draft PR; `full-commit` pushes straight to the failing branch after a one-time per-project confirmation. A failure on a commit the daemon itself pushed as a fix is never fixed a second time, and `full-commit` confirmation and `ciWatch` are only read from your global preferences, never from a project file.

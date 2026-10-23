---
title: "Verify"
description: "Headless, read-only PR review from the command line"
sidebar_order: 15
---

# Verify

`nanocoder verify --pr <n>` reviews an open pull request from the command
line, without starting an interactive session. It reads the PR's diff and CI
status, runs a [semgrep](https://semgrep.dev/) static-analysis pass scoped
to the changed files, and produces a structured Markdown review.

```bash
nanocoder verify --pr 861                  # print the review to stdout
nanocoder verify --pr 861 --post-review    # also post it as a PR comment
```

## What it does

1. Confirms the local working tree is checked out to the PR's head branch
   (via `gh`). If it isn't, `verify` fails fast with the exact `gh pr
   checkout <n>` command to run first — it never checks out branches on
   your behalf, since this is meant to be a read-only tool.
2. Runs a semgrep scan (`--config auto`) scoped to the PR's changed files
   only, so results reflect what the PR introduces rather than pre-existing
   findings elsewhere in the repo. Findings are capped at 50 (sorted by
   severity); the review discloses when more were found than shown.
3. Runs the built-in `verify-pr-review` subagent — a read-only reviewer that
   reads the diff, CI checks, and relevant local files, then writes a
   Summary/Findings/Suggestions review. It cannot comment, review, or open
   PRs itself; those tool calls are denied by the harness even if attempted,
   and no `alwaysAllow` setting changes that. It is always the built-in
   definition: a `.nanocoder/agents/verify-pr-review.md` in the checkout
   (which the PR itself could add) is ignored for this run.
4. Formats the subagent's narrative plus the semgrep findings into one
   review body, masks anything that looks like a secret (common token
   formats, private keys, and the values of environment variables whose
   names contain TOKEN, KEY, SECRET or PASSWORD), and either prints it (the
   default) or posts it via `gh pr review --comment` with `--post-review`.

## Advisory only

`verify` always posts as a plain comment (`--comment`), never
`--approve`/`--request-changes` — it does not block merges. Blocking
verdicts are part of a later phase of the Agentic CI/CD Gate roadmap, gated
behind an explicit trust level.

## Directory trust

Because the checked-out PR is code you may not know, `verify` refuses to run
in a directory you haven't trusted, the same check `nanocoder run` makes.
Pass `--trust-directory` to bypass it for one run, or set
`NANOCODER_TRUST_DIRECTORY=1` to trust the directory permanently (for
example in CI). Only do this for PRs you are willing to run: once trusted,
`verify` loads the checkout's own `agents.config.json` and `.mcp.json`.

## Flags

| Flag | Description |
|------|-------------|
| `--pr <n>` | Required. The PR number to review. |
| `--post-review` | Post the review as a PR comment instead of printing it. |
| `--trust-directory` | Run in an untrusted directory for this run only. |
| `--provider <name>` | Override the LLM provider for this run. |
| `--model <name>` | Override the model for this run. |

## Requirements

- `gh` CLI installed and authenticated.
- The PR's head branch checked out locally (`verify` checks this and tells
  you the exact command if it isn't).
- [semgrep](https://semgrep.dev/) installed to get static-analysis findings
  — optional; `verify` degrades gracefully and notes it was skipped if
  semgrep isn't on `PATH`.

## Running in CI

`verify` compares your checkout's commit with the PR's head commit. On a
`pull_request` workflow, `actions/checkout` checks out a synthetic merge
commit by default, so that check would always fail. Check out the PR head
instead:

A fresh CI runner has never trusted the checkout directory, so pass
`--trust-directory` (or set `NANOCODER_TRUST_DIRECTORY=1`):

```yaml
- uses: actions/checkout@v4
  with:
    ref: ${{ github.event.pull_request.head.sha }}
- run: nanocoder verify --pr ${{ github.event.pull_request.number }} --post-review --trust-directory
```

**Warning:** trusting the directory means `verify` loads the checkout's own `agents.config.json` and `.mcp.json`. On a PR from a fork, that is the fork author's file, so its hooks and MCP servers run inside your job with whatever the job's `GITHUB_TOKEN` and secrets allow. Run `verify` on fork PRs only from a plain `pull_request` workflow with a read-only token and no secrets beyond the LLM provider key, never from `pull_request_target`, or limit it to PRs from branches in your own repository.

## Related: CI watch

The per-project daemon can also watch GitHub Actions for failures and
investigate them (`ciWatch` in preferences, `daemon start --trust ...`); see
[Preferences](../configuration/preferences.md#ci-watch-configuration).

`--trust <level>` sets the CI investigation level (`comment-only`, `auto-fix` or `full-commit`) and is unrelated to `--trust-directory`. Without `--trust`, `daemon start` uses `verify.trustLevel` from `agents.config.json`, but a config file can only raise the level with your confirmation:

- `auto-fix` from config asks for confirmation each time `daemon start` runs in a terminal (pass `--trust auto-fix` to skip the prompt).
- `full-commit` from config needs the same one-time confirmation as `--trust full-commit`.
- An unattended start that cannot ask, such as the service `nanocoder daemon install` sets up, runs at `comment-only` instead, unless the project was already confirmed for `full-commit`.

`nanocoder daemon status` shows the level a running daemon is using. To change it, stop the daemon and start it again; `daemon start` on an already running daemon does not apply a new `--trust`.

At `auto-fix` and `full-commit` the fix agent runs in a throwaway clone with no GitHub or git credentials: no `GH_TOKEN`/`GITHUB_TOKEN`, an empty `gh` config, no ssh-agent and no git credential helper, so it cannot push or call `gh` itself. The daemon fetches the failed-step log for it beforehand and publishes its commits afterwards from your project repository. The agent still runs shell commands as your user, so treat these levels as letting a CI log run code on your machine.

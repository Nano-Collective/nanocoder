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
   PRs itself; those tool calls are denied by the harness even if attempted.
4. Formats the subagent's narrative plus the semgrep findings into one
   review body, and either prints it (the default) or posts it via
   `gh pr review --comment` with `--post-review`.

## Advisory only

`verify` always posts as a plain comment (`--comment`), never
`--approve`/`--request-changes` — it does not block merges. Blocking
verdicts are part of a later phase of the Agentic CI/CD Gate roadmap, gated
behind an explicit trust level.

## Flags

| Flag | Description |
|------|-------------|
| `--pr <n>` | Required. The PR number to review. |
| `--post-review` | Post the review as a PR comment instead of printing it. |
| `--provider <name>` | Override the LLM provider for this run. |
| `--model <name>` | Override the model for this run. |

## Requirements

- `gh` CLI installed and authenticated.
- The PR's head branch checked out locally (`verify` checks this and tells
  you the exact command if it isn't).
- [semgrep](https://semgrep.dev/) installed to get static-analysis findings
  — optional; `verify` degrades gracefully and notes it was skipped if
  semgrep isn't on `PATH`.

---
title: "Code Review"
description: "One-shot, diff-only review of a branch or pull request with /review"
sidebar_order: 23
---

# Code review

`/review` sends a diff to the active model with a review prompt and shows the reply in the chat. It looks for bugs, security issues, and style violations. It is a deliberate v1: diff-only and one-shot, so the model does not read other files or run tools (see [#1287](https://github.com/Nano-Collective/nanocoder/issues/1287) for the planned agentic tier).

## Usage

```text
/review                                          # current branch against its base
/review main                                     # same, when main is the default branch
/review feature/auth                             # another branch against its base
/review 42                                       # pull request #42 (needs the gh CLI)
/review https://github.com/owner/repo/pull/42    # pull request by URL
```

Pass at most one target. A leading `quick` (`/review quick 42`) is accepted and runs the same one-shot review.

The same review is available outside the TUI as `nanocoder review <target>`, which needs an interactive terminal.

## Choosing the base

A branch review diffs the branch against the branch it would merge into:

1. If the branch has an open pull request (found with `gh`), that pull request's base branch on the matching remote.
2. Otherwise the default branch of the parent repository when the clone is a fork and the parent is a configured remote, then of `upstream` or `origin`.
3. As a last resort, your local default branch, with a notice that it may be out of date.

The scope line at the top of the result says which base was used. If a base ref has not been fetched yet, the notice tells you which `git fetch` to run.

## Pull requests

Bare PR numbers are looked up across configured GitHub remotes and their fork parents. If a number matches pull requests in more than one repository, pass the full PR URL instead. PR review requires the [gh CLI](https://cli.github.com).

## Limits

Diffs longer than 1,000 lines are cut to their first and last 500 lines, and the result says so. Review a smaller range when you need full coverage.

A custom command named `review` replaces the built-in (see [custom commands](custom-commands.md)).

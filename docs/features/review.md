---
title: "Code review"
description: "Grounded, evidence-checked review of a branch, pull request, commits, or working tree"
sidebar_order: 23
---

# Code review

`/review` runs a grounded review: an agent investigates the exact revision under review with read-only tools, every reported issue must cite `file:line` on or near a changed line (within three lines, or at a deletion boundary), and an independent verifier re-checks each issue before it is shown. `/review deep` runs the same checks with three specialist finders. `/review quick` keeps the original one-shot, diff-only review.

## Choosing what to review

| Command | Reviews |
| --- | --- |
| `/review` | The current branch against its base, or the working tree when only uncommitted changes exist. If both exist, you are asked to choose |
| `/review feature/auth` or `/review branch feature/auth` | A local or remote branch against the default branch |
| `/review 42`, `/review PR 42`, or a GitHub PR URL | A pull request, pinned to its current head. Bare numbers are resolved across configured GitHub remotes and fork parents |
| `/review last 3 commits` | Recent commits on the current branch (`last 3 commits on branch <name>` for another branch) |
| `/review working tree` | Uncommitted changes, including untracked files |
| `/review deep [target]` | The same review with three specialist finders (bugs, standards and API misuse, intent and spec), then one shared verification pass |
| `/review quick [<branch or PR>]` | The one-shot diff review |
| `/review activity` | The detailed activity trace of the latest review in this session |

When a target is ambiguous (for example a local and a remote branch with the same name) the review stops and lists the choices instead of guessing. Working-tree reviews read your changes through a scratch Git index, so staged changes and files are never modified.

## How a grounded review works

1. **Pin the scope.** Base and head commits are resolved and the changed files are snapshotted. Remote targets are fetched into temporary refs and never checked out, so your working tree is untouched.
2. **Find.** A finder agent gets the diff and can call `review_changed_files`, `review_diff`, `review_read_file`, `review_search`, and `review_log`. These tools answer from the pinned revision, not from whatever is checked out. The agent has a fixed budget of model turns, tool calls, and model context; when any budget runs out it stops calling tools and reports with what it has.
3. **Check citations.** Each issue must point at an existing line of a changed text file, in or within three lines of a changed line or a deletion boundary in the head. Issues that do not are dropped and listed under **Dropped**.
4. **Verify.** Each remaining issue (up to 8, most severe first, one per cited line before any second issue on the same line) goes to a separate verifier agent that re-reads the code and answers `CONFIRM`, `REJECT`, or `INSUFFICIENT` with a confidence. Only confirmations with confidence 80 or higher are reported as findings. An unverified issue on a line that already has a verified finding is listed as a note instead, so it does not mark the review incomplete.

Models without native tool calling use the same text tool-call fallback as normal chat.

## Deep review

`/review deep` uses the same pinned revision, citation check, verifier, activity view, and saved summary. It runs three finders, each with its own tool budget:

- **bugs**: logic errors, edge cases, races, error handling, security
- **standards and API misuse**: wrong or deprecated APIs, type-safety, leaks, surrounding patterns
- **intent and spec**: whether the change does what it claims, and whether callers or migrations are left unfinished

Findings that cite the same line and describe the same issue are merged before verification, and the report notes which perspective already covered them. A specialist that fails or runs out of budget makes the review incomplete; the other specialists' findings are still verified. The review fails only when every specialist finder fails.

## Reading the result

The report renders like a normal assistant reply, headed by the review status:

- **completed**: the finder finished within budget, every changed text file was covered, and every cited issue was verified. Only a completed review says "No verified issues found".
- **incomplete**: something limited coverage — the finder hit its budget, a file too large for the initial diff was never fully inspected, model output was cut off at its output limit, the finder's output could not be read, or some issues were not verified. An omitted file requires an untruncated whole-file diff or read; partial ranges and clipped tool output do not count as full coverage. Truncated verifier output cannot confirm an issue. The report lists why under **Why this review is incomplete**; treat it as partial.
- **failed** or **cancelled**: the review stopped early; any partial results are labeled.

While a review runs, a live activity view shows its agents, tool calls, and model calls. Press `d` to show details and `Esc` to cancel. The view only captures keys while the review is running.

## Session history

The report and a bounded, sanitized activity summary are saved with the session, so they reappear when the session is resumed and `/review activity` still works. The summary holds step names, statuses, timings, and safe arguments only — never prompts, diffs, or file contents. The review is shown to you but is not sent to the model as part of later conversation turns.

## Quick review

`/review quick [<branch or PR>]` sends one diff to the active model with a review prompt and shows the reply. The model does not read other files or run tools.

A quick branch review diffs the branch against the branch it would merge into:

1. If the branch has an open pull request (found with `gh`), that pull request's base branch on the matching remote.
2. Otherwise the default branch of the parent repository when the clone is a fork and the parent is a configured remote, then of `upstream` or `origin`.
3. As a last resort, your local default branch, with a notice that it may be out of date.

The scope line at the top of the result says which base was used. If a base ref has not been fetched yet, the notice tells you which `git fetch` to run. Bare PR numbers are looked up across configured GitHub remotes and their fork parents; if a number matches pull requests in more than one repository, pass the full PR URL instead. PR review requires the [gh CLI](https://cli.github.com).

Diffs longer than 1,000 lines are cut to their first and last 500 lines, and the result says so. Review a smaller range when you need full coverage.

## Outside the TUI

The same review is available as `nanocoder review <target>`, which needs an interactive terminal.

A custom command named `review` replaces the built-in (see [custom commands](custom-commands.md)).

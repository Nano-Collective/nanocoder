---
description: Run the engineer, DX, new-user and QA reviewers in parallel over a diff and produce one consolidated report
parameters: ["target=", "base=main"]
category: review
examples:
  - /pr-review
  - /pr-review feat/my-branch
  - /pr-review a1b2c3d..e4f5g6h
  - /pr-review feat/my-branch develop
---

Run a four-reviewer review of a change and consolidate the results. You are the orchestrator: you resolve the scope, dispatch the reviewers, and merge their reports. Do not review the code yourself and do not edit any files.

## 1. Resolve the scope

{{# target }}The requested target is `{{target}}`, with base `{{base}}`.
- If it contains `..` it is a commit range - use it as-is.
- If it is a branch name, the scope is `{{base}}...{{target}}`.
- If it is a single commit SHA, the scope is `{{target}}^..{{target}}`.
{{/ target }}{{^ target }}No target was given, so review the current work: the branch diff `{{base}}...HEAD` plus any uncommitted changes (unstaged and staged).
{{/ target }}
Confirm the scope is non-empty with `git_diff` (`stat: true`) and `git_log`. If it is empty, stop and tell the user there is nothing to review. Otherwise write down a one-line scope description, e.g. `main...HEAD (12 files, +340/-85) plus uncommitted changes in 2 files`, and the commit subjects from `git_log` as a short summary of intent.

## 2. Dispatch the four reviewers in parallel

In a **single response**, call the `agent` tool four times - one per reviewer - so they run in parallel:

| subagent_type | focus |
|---|---|
| `engineer-reviewer` | correctness, performance, test coverage, readability |
| `dx-reviewer` | breaking changes, error messages, safety, ergonomics |
| `normal-user` | first-time user experience and docs |
| `qa-tester` | security and regressions against previous use, runs tests |

Give every reviewer the same `prompt`: the exact scope (the `git_diff` `base` value(s) to use, and whether to include uncommitted changes), the commit subjects, and the stat summary. Tell each one to return its report in its standard format. Do not add your own opinions about the code to the prompt.

If a reviewer fails or returns nothing usable, retry it once on its own. If it still fails, continue with the others and record it as missing.

## 3. Consolidate

Merge the findings from all reports:

- **Deduplicate**: findings from different reviewers about the same root cause (same file and line range, or the same underlying problem) become one entry, credited to every reviewer that raised it. Keep the highest severity and the most concrete fix.
- **Do not invent** findings, and do not drop any finding. You may only merge duplicates.
- **Overall severity** = the highest severity of any merged finding (`blocker` > `major` > `minor` > `nit` > `none`).
- **Overall verdict**: `request-changes` if there is any blocker or major finding, or if any reviewer returned `request-changes`; `approve-with-nits` if only minor or nit findings remain; otherwise `approve`.

## 4. Output

Print exactly this structure:

```
# PR review: <scope description>

**Verdict:** <approve | approve-with-nits | request-changes>  ·  **Overall severity:** <blocker | major | minor | nit | none>

| Reviewer | Verdict | Blocker | Major | Minor | Nit |
|---|---|---|---|---|---|
| Engineer | ... | n | n | n | n |
| DX | ... | n | n | n | n |
| New user | ... | n | n | n | n |
| QA / security | ... | n | n | n | n |

## Summary
<3-6 sentences: what the change does, its biggest risks, and what must happen before merge>

## Consolidated findings
1. **[severity]** `path:line` - title  _(raised by: Engineer, QA)_
   Why: ...
   Fix: ...
...

## Individual reports
<each reviewer's full report, verbatim, in the order Engineer, DX, New user, QA / security>
```

If a reviewer was missing, say so in its table row and under its heading in "Individual reports".

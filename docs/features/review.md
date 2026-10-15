---
title: "Review foundation"
description: "How review target discovery and activity tracking are being staged"
sidebar_order: 23
---

# Review foundation and rollout

The review work is being delivered in stages so scope discovery and validation can be exercised before they become the default user path.

## What is available in the Foundation stage

The public `/review` and `/review quick` commands keep their existing one-shot behavior in this stage. They do not show the new coordinator activity view, start agents, or change the review target-selection flow.

The internal Foundation coordinator can be exercised by its integration tests. It parses explicit branch, recent-commit, working-tree, and GitHub pull-request requests; verifies candidate refs; pins commit IDs; and reads bounded file snapshots and changed-line maps without checking out remote targets. PR snapshots retain the current base tip as well as the merge-base and pinned head used for changed-line mapping. Working-tree reviews record tracked and untracked (non-ignored) changes as a Git tree through a scratch index, so the real index and files are left untouched. Remote revisions are fetched into one fixed ref per source under `refs/nanocoder/review/`, which is removed after the review. It asks for clarification when candidates collide or when dirty worktree changes and branch-ahead commits coexist.

The internal activity view is driven by the same bounded event store used by that coordinator. Its key handling is opt-in so an inline transcript panel cannot consume composer input; when focused, `d` shows safe arguments and bounded event history, and Escape requests cancellation once while a run is active. Neither key changes current public `/review` behavior.

Snapshot limits fail the resolution rather than returning a partial scope: oversized files, excessive file counts, or total content above the configured budget are not presented as a complete review.

## What comes later

The next stage wires the verified coordinator into the default review path. Deeper review, additional finders, and headless JSON output are separate follow-on work; they are not part of this foundation.

The activity summary can be serialized and safely parsed, but this stage does not persist review traces into saved sessions. Session-resume persistence is deferred to the grounded default review stage, when the coordinator is connected to a real session owner. Acceptance test for that stage: complete, fail, and cancel a review; close and resume the session; verify that the corresponding bounded, sanitized summary is still inspectable with its review identity, terminal status, and safe event history, without persisting prompts, diffs, or secrets.

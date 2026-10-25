---
title: "Persistent Plan Graphs"
description: "Durable, dependency-aware plans that survive session restarts and can be resumed mid-flight"
sidebar_order: 6
---

# Persistent Plan Graphs

Plan mode has always produced a Markdown plan. A persistent plan graph adds the
structure a long-running task needs: every step is a node with an id, a status,
and the steps it depends on. The graph is written to disk, so closing the
terminal or resuming a different session does not lose the work.

```text
Plan: Auth refactor (3/12 done)
id: auth-refactor
4 todo · 2 doing · 3 done · 1 blocked
Ready now: wire-session, add-tests
Blocked: rotate-keys (waiting for credentials)

✓ spec         Write the auth spec
✓ db           Add the session table
◐ api          Implement the token endpoint  (agent: general)
○ wire-session Connect the callback         (after: api)
! rotate-keys  Rotate production keys       (blocked: waiting for credentials)
```

## Where It Lives

Plan graphs are project state, not session state:

- `.nanocoder/plans/<id>.jsonl` — one plan. The first line is a header; every
  following line is a node.
- `.nanocoder/plans/index.json` — the active plan id and lightweight summaries.
- `.nanocoder/plans/` is added to `.nanocoder/.gitignore` automatically, along
  with checkpoints and timeline data. It is runtime state; do not commit it.

Each JSONL line is a complete record, so the file is readable and diffable:

```jsonl
{"type":"header","version":1,"id":"auth-refactor","title":"Auth refactor","createdAt":"…","updatedAt":"…"}
{"type":"node","id":"db","title":"Add the session table","status":"done","dependsOn":[],"createdAt":"…","updatedAt":"…"}
{"type":"node","id":"api","title":"Implement the token endpoint","status":"doing","dependsOn":["db"],"agent":"general","createdAt":"…","updatedAt":"…"}
```

Writes are whole-file atomic snapshots guarded by a cross-process lock, so two
terminals (or the VS Code extension and a terminal) can update the same plan
without corrupting it.

## Node Statuses

| Status | Meaning |
|--------|---------|
| `todo` | Not started. Ready when every dependency is `done`. |
| `doing` | In progress. Requires all dependencies to be `done`. |
| `done` | Finished. Unblocks its dependents. |
| `blocked` | Cannot proceed. Requires a `blockedReason` so the next session knows what is missing. |

A node can also carry:

- `dependsOn` — ids that must finish first. Cycles are rejected.
- `agent` — the subagent type best suited to the node. The model is instructed
  to use that type when it delegates.
- `checkpoint` — the name (or action-timeline id) of a
  [checkpoint](checkpointing.md) linked to the node's work.

Graphs are capped at 200 nodes, and a node may only be `doing` or `done` once
its dependencies are `done`. That rule is what makes the "ready now" list
trustworthy after a restart.

## Creating a Graph

In plan mode, the AI calls `write_plan` with both the Markdown plan and a
`nodes` array. The Markdown is saved as the session's plan artifact as before;
the node list is persisted as the project graph.

```json
{
  "content": "# Auth refactor\n…",
  "title": "Auth refactor",
  "nodes": [
    {"id": "spec", "title": "Write the auth spec"},
    {"id": "db", "title": "Add the session table", "depends_on": ["spec"]},
    {"id": "api", "title": "Implement the token endpoint", "depends_on": ["db"], "agent": "general"}
  ]
}
```

Calling `write_plan` again replaces the whole node list. Use
`update_plan_node` for day-to-day changes instead of resending the graph.

## Keeping It Current

The AI has two graph tools in execution modes:

- `get_plan` — read the active graph, its ready nodes, waiting nodes, blocked
  reasons, and assignments.
- `update_plan_node` — change one node's `status`, `agent`, `checkpoint`,
  `blocked_reason`, or dependencies.

The active plan is also appended to the system prompt on every turn, so a
resumed session immediately knows where it stopped, what is ready, and what is
blocked. This happens in the TUI and in ACP/editor sessions, and once at startup
for a non-interactive `run`. The graph is deliberately not part of the cached
base prompt: it changes between turns and must be re-read from disk.

`update_plan_node` is unavailable in plan mode — planning can define the graph,
but marking work as done is execution. Subagents never receive the write tools,
so a delegated agent cannot mark the parent's plan as complete.

## Managing Plans

```bash
/plans                  # List every plan graph in this project
/plans show             # Dashboard for the active plan
/plans show auth-refactor
/plans use auth-refactor  # Make a plan active (injected into every turn)
/plans use none         # Stop injecting a plan
/plans delete auth-refactor
```

The **active** plan is the one shown by `/plans show` and appended to the
prompt. Creating a plan makes it active automatically. If you keep several
plans in one project, select the one you are resuming with `/plans use <id>`.

## Resuming Mid-Plan

Because the graph is project-scoped, a restart is enough:

1. Start Nanocoder again (or `/resume` the previous session).
2. The active plan is loaded from `.nanocoder/plans/` and added to the prompt.
3. The AI calls `get_plan`, picks a node from **Ready now**, marks it `doing`,
   and continues.

If a node is blocked, the reason travels with it. A fresh session sees the
blocker instead of guessing, and can either resolve it or dispatch the node's
assigned `agent`.

## Plans and Tasks

[Tasks](task-management.md) are session-scoped and flat: a quick checklist for
the current conversation. Plan graphs are project-scoped and dependency-aware:
they survive the session, gate execution order, and carry status across
sessions and agents. Use tasks for short work; use a plan graph when work spans
sessions or has real ordering constraints.

## Related

- [Development Modes](development-modes.md) — plan mode and the review flow
- [Checkpointing](checkpointing.md) — checkpoints you can link from a node
- [Subagents](subagents.md) — the agents a node can be assigned to
- [Task Management](task-management.md) — the lightweight, session-scoped list

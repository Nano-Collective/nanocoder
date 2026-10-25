---
"@nanocollective/nanocoder": minor
---

Plan mode can now persist its output as a durable dependency graph, not just a Markdown file. Calling `write_plan` with `nodes` writes `.nanocoder/plans/<id>.jsonl` (gitignored runtime state) and records the plan in `.nanocoder/plans/index.json`, so a plan survives closing the terminal and resuming in a new session.

Each node has an id, title, status (`todo`, `doing`, `done`, `blocked`), dependencies, an optional assigned subagent, and an optional timeline-checkpoint link. Blocked nodes require a reason. Cycles, duplicate ids, missing dependencies, and marking a node `doing`/`done` before its dependencies are `done` are rejected. Graphs are capped at 200 nodes and written atomically under a cross-process lock.

Two new tools keep the graph current: read-only `get_plan` and `update_plan_node` (unavailable in plan mode and to subagents). The active plan is appended to the system prompt each turn, so a resumed session knows its progress, ready nodes, and blockers.

Use the new `/plans` command to list graphs, show a dashboard (`3/12 done, blocked on auth`), switch the active plan with `/plans use <id>`, or delete one. `write_plan` without `nodes` behaves exactly as before.

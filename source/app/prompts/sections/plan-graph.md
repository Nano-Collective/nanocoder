## PERSISTENT PLAN GRAPH

A plan can be persisted as a task graph, not just markdown. The graph lives in
`.nanocoder/plans/` and is shared across sessions, so it is the source of truth
for "what is left" after a restart.

- **Create or replace the graph** with `write_plan` (plan mode): pass `content`
  (the Markdown plan) and `nodes`. Every node needs a `title`; give it a stable
  `id` and list prerequisite ids in `depends_on`. `write_plan` replaces the
  whole node list, so include every node each time.
- **Update as you execute** with `update_plan_node` (available outside plan
  mode): set `status` to `doing` when you start a node and `done` when it is
  finished. A node can only be `doing` or `done` once all of its dependencies
  are `done`.
- **Blocked work stays visible**: set `status: "blocked"` with a
  `blocked_reason` naming exactly what is missing. Do not silently skip it.
- **Link work to checkpoints**: when a checkpoint or action-timeline entry
  covers a node, set its `checkpoint` field to that name or id. Set `agent` to
  the subagent type that should handle the node; if you delegate it, use that
  same type with the `agent` tool.
- **Read before acting** with `get_plan` when it is available. The active plan
  and its ready nodes are also appended to this prompt on every turn.
- Complete dependencies before dependents. If the remaining work no longer
  matches the graph, update it (`write_plan` while planning,
  `update_plan_node` while executing) rather than pretending it is done.

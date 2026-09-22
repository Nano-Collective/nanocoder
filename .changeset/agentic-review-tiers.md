---
"@nanocollective/nanocoder": minor
---

Upgrades /review from a one-shot model response to tool-grounded, verified review with three tiers.

- `/review` (default) now runs an agentic pipeline: a read-only finder subagent investigates the diff under tool-call and turn budgets, every finding passes a deterministic citation gate (file exists, line in range and near changed hunks), and an independent verifier subagent confirms, rejects, or marks each finding insufficient before it reaches the report. Dropped findings stay visible with their reasons.
- `/review quick` preserves the original one-shot behaviour for fast feedback.
- `/review deep` runs three specialist finders (bugs, standards and API misuse, intent/spec), deduplicates overlapping findings, and verifies the survivors.
- `nanocoder review` now works without a TTY. Output redirects cleanly (report to stdout, status to stderr), and `--output-format json` emits a structured document (tier, target, confirmed/dropped findings, notes, approximate usage) for scripts and CI.
- `SubagentExecutor.execute()` accepts optional runtime limits (`allowedTools`, `maxToolCalls`, `maxTurns`) so callers can bound delegated runs; limits only narrow a subagent's own tool list, and omitting them preserves existing behaviour.
- Built-in `review-finder` and `review-verifier` subagents are registered programmatically; user and project agent definitions of the same names take precedence.

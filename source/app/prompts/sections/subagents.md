## SUBAGENTS

Delegate tasks to subagents using the `agent` tool. Each subagent runs in its own isolated context and returns only its final result. This is critical for preserving your context window — every file read, search result, and tool output a subagent processes does NOT consume your context.

**Prefer subagents over direct tool calls when a task requires multiple steps.** Only use direct tool calls when you already know exactly what to do (e.g. a single file read or a targeted edit).

You can call the `agent` tool multiple times in a single response — all calls execute in parallel. Use this whenever you have multiple independent tasks.

### When to use subagents:
- Exploring unfamiliar code or understanding architecture
- Searching for patterns, usages, or implementations across the codebase
- Reviewing changes or diffs
- Any task that might require multiple tool calls to complete
- When you have multiple independent tasks — launch them in parallel

### When NOT to use subagents:
- You already know the exact file path and line range to read
- You're making a single targeted edit to a file you've already read
- The task is a simple one-shot tool call

## TASK MANAGEMENT

**Use `write_tasks` for complex work** (3+ steps, multiple files, investigation/debugging, new features, refactoring). This is critical for tracking progress.

`write_tasks` replaces the entire task list every call — always pass the COMPLETE list:
1. **FIRST ACTION**: call `write_tasks` with one task per step, all `pending`
2. To start a step, resend the full list with that task set to `in_progress` (keep at most one `in_progress` at a time)
3. To finish a step, resend the full list with that task set to `completed`
4. To add or drop work, resend the list with tasks added or omitted
5. When the request is complete, call `write_tasks` with an empty array to clear the list

Tasks persist in `.nanocoder/tasks.json` across sessions. Running `/clear` resets all tasks.

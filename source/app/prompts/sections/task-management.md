## TASK MANAGEMENT

**Use task tools for complex work** (3+ steps, multiple files, investigation/debugging, new features, refactoring). This is critical for tracking progress.

**Required workflow**:
1. **FIRST ACTION**: Create tasks for each step before doing any work
2. Before creating new tasks, review existing tasks and clear completed or stale tasks that are unrelated to the current request
3. Update task status to `in_progress` when starting, `completed` when done
4. When the request is complete, delete completed tasks so the task list is ready for the next request
5. Review progress with `list_tasks`

Tasks persist in `.nanocoder/tasks.json` across sessions. Running `/clear` resets all tasks.

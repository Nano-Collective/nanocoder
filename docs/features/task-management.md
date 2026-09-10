---
title: "Task Management"
description: "Track complex multi-step work with the built-in task management system"
sidebar_order: 5
---

# Task Management

For complex, multi-step work, the task system helps you and the AI stay aligned on what needs to be done. You can create tasks manually, or the AI will create and update them automatically when working on involved problems.

## When to Use Tasks

- Breaking down a large feature into trackable steps
- Keeping the AI focused on a specific piece of work within a larger plan
- Tracking progress across a session

## Commands

```bash
/tasks                          # View all tasks with status
/tasks add Implement auth       # Add a new task
/tasks Implement auth           # Shorthand — same as above
/tasks remove 1                 # Remove task by number
/tasks rm 1                     # Alias for remove
/tasks clear                    # Clear all tasks
```

## AI-Managed Tasks

The AI has a single task tool, `write_tasks`, and will use it proactively when working on complex problems. It always sends the complete list, which replaces the previous one — that is how a task moves from pending to in-progress to completed. You can ask the AI to break work into tasks:

```
Break this feature into tasks and work through them one by one.
```

The AI will create a task list, mark tasks as in-progress or complete as it works, and keep the list updated. Completed tasks are left in place so the session keeps a record of what was done; the AI only clears the list if you ask it to.

## Storage

Task state belongs to the session, not to your project directory.

- Tasks are stored with the session's other artifacts, under the platform app data directory: `<app data>/nanocoder/artifacts/<session id>/`
- `tasks.json` holds the internal state; `task.md` is a readable Markdown rendering of the same list, reachable from the **Tasks** shortcut above the prompt
- Nothing is written into your repository, so there is nothing to add to `.gitignore`
- Resuming a session with `--resume` or `--continue` restores its task list
- `/clear` starts a new session with an empty list. The previous session keeps its task record, so you can resume it later
- Deleting a session (or letting session retention expire it) deletes its task artifacts too

> **Upgrading from an earlier version?** Tasks used to live in `.nanocoder/tasks.json` inside the working directory. That file is no longer read or written. If one is left over from a previous version you can safely delete it.

## Tasks and Tool Profiles

`write_tasks` is part of the **full** tool profile. The `minimal` and `nano` profiles deliberately trade it away for a smaller prompt, so the AI will not create or update tasks while one of those profiles is active — `/tasks` still works for managing the list by hand. See [Tune](tune.md) for how profiles resolve.

## Related

- [Development Modes](development-modes.md) — plan mode produces a plan artifact alongside the task list
- [Session Management](session-management.md) — how sessions and their artifacts are stored and resumed

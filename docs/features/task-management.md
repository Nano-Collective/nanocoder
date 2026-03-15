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

The AI has access to task management tools (`create_task`, `list_tasks`, `update_task`, `delete_task`) and will use them proactively when working on complex problems. You can ask the AI to break work into tasks:

```
Break this feature into tasks and work through them one by one.
```

The AI will create a task list, mark tasks as in-progress or complete as it works, and keep the list updated.

## Storage

- Tasks are stored in `.nanocoder/tasks.json` in your project directory
- Tasks are automatically cleared on startup and when using `/clear` to keep the list fresh
- Consider adding `.nanocoder/tasks.json` to your `.gitignore`

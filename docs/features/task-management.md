---
title: "Task Management"
description: "Track complex multi-step work with the built-in task management system"
sidebar_order: 5
---

# Task Management

Nanocoder provides a task management system for tracking complex multi-step work. Tasks persist in `.nanocoder/tasks.json` and are useful for both users and AI models to track progress on involved tasks.

The LLM has access to task management tools (`create_task`, `list_tasks`, `update_task`, `delete_task`) and will automatically use them to track progress on complex work. You don't need to manually create tasks if you don't want to - the AI will manage them for you.

## Task Commands

- `/tasks` - Show all tasks with their status
- `/tasks add <title>` - Add a new task (also works: `/tasks <title>`)
- `/tasks remove <number>` - Remove a task by number (alias: `/tasks rm <number>`)
- `/tasks clear` - Clear all tasks

## Examples

```bash
# View current tasks
/tasks

# Add a new task
/tasks add Implement user authentication

# Or simply type the task title
/tasks Implement user authentication

# Remove a task (note the number)
/tasks remove 1

# Clear all tasks
/tasks clear
```

## Storage

- Tasks are stored in `.nanocoder/tasks.json` in your project directory
- Tasks are automatically cleared when Nanocoder starts (to keep the task list fresh)
- Tasks are also cleared when using the `/clear` command
- Consider adding `.nanocoder/tasks.json` to your `.gitignore` if you want to exclude it from version control

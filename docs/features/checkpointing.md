---
title: "Checkpointing"
description: "Save and restore conversation snapshots for experimenting with different approaches"
sidebar_order: 4
---

# Checkpointing

Checkpointing lets you save a snapshot of your current session — conversation history, file changes, and configuration — so you can experiment freely and roll back if things don't work out. Think of it like a save point in a game.

## When to Use Checkpoints

- Before attempting a risky refactor or architectural change
- When you want to try two different approaches and compare
- To preserve a working state before the AI makes further changes

## Commands

- `/checkpoint create [name]` — Save a checkpoint (auto-generates a timestamp name if omitted)
- `/checkpoint list` — List all checkpoints with creation time, message count, and files changed
- `/checkpoint load [name]` — Restore files from a checkpoint (interactive selector if no name given)
- `/checkpoint delete <name>` — Permanently delete a checkpoint

## What Gets Saved

- Complete conversation history
- Modified files with their content (detected via git)
- Active provider and model configuration
- Timestamp and metadata

## Example Workflow

```bash
# Save current state before trying something new
/checkpoint create before-refactor

# Ask the AI to try an approach...
# If it doesn't work out:
/checkpoint load before-refactor

# If it went well, save the new state:
/checkpoint create after-refactor

# Compare what you have:
/checkpoint list
```

When loading a checkpoint that would overwrite current work, Nanocoder prompts you to create a backup first.

## Storage

Checkpoints are stored in `.nanocoder/checkpoints/` in your project directory. Each project has its own checkpoints. Consider adding `.nanocoder/checkpoints` to your `.gitignore`.

> **Note:** Loading a checkpoint restores files immediately, but restoring conversation history requires restarting Nanocoder.

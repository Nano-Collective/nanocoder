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

Files are saved and restored byte for byte, so binaries — images, fonts, compiled artifacts — survive a round trip intact alongside text.

## Incomplete Checkpoints

A checkpoint can cover less than your whole workspace:

- A file that could not be read when the checkpoint was taken — an editor or antivirus holding a lock, or permissions — was never captured
- At most 50 modified files are captured; anything beyond that is left out
- A file that was captured but whose stored copy has since gone missing cannot be restored

Any of these are reported when you restore, naming the files that were not put back, so a partial restore never looks like a complete one.

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

Snapshots skip anything matched by `.gitignore`, but deliberately ignore [`.nanocoderignore`](../configuration/index.md#ignoring-files). Hiding a file from the model's listings shouldn't quietly exclude it from restore, so a file in `.nanocoderignore` is still snapshotted and still reverted.

> **Note:** Loading a checkpoint restores files immediately, but restoring conversation history requires restarting Nanocoder.

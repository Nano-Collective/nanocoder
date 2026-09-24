---
title: "Checkpointing"
description: "Save and restore conversation snapshots for experimenting with different approaches"
sidebar_order: 4
---

# Checkpointing

Checkpointing lets you save a snapshot of your current session - conversation history, file changes, and configuration - so you can experiment freely and roll back your files if things don't work out. Think of it like a save point in a game.

## When to Use Checkpoints

- Before attempting a risky refactor or architectural change
- When you want to try two different approaches and compare
- To preserve a working state before the AI makes further changes

## Commands

- `/checkpoint create [name]` (alias `save`) - Save a checkpoint (auto-generates a timestamp name if omitted)
- `/checkpoint list` (alias `ls`) - List all checkpoints with creation time, message count, and files changed
- `/checkpoint load [name]` (alias `restore`) - Restore files from a checkpoint (interactive selector if no name given)
- `/checkpoint delete <name>` (aliases `remove`, `rm`) - Permanently delete a checkpoint, immediately and without a confirmation prompt
- `/checkpoint help` - Show command help

## What Gets Saved

- Complete conversation history (stored for reference; see the note below)
- Modified files with their content (detected via git)
- Active provider and model configuration
- Timestamp and metadata

Files are saved and restored byte for byte, so binaries — images, fonts, compiled artifacts — survive a round trip intact alongside text.

Nanocoder's own runtime state under `.nanocoder/` (earlier checkpoints, the action timeline, daemon files) is never captured, so checkpoints don't snapshot each other. Your own content there, such as `.nanocoder/commands`, `agents`, `tools` and `skills`, is still captured.

## Incomplete Checkpoints

A checkpoint can cover less than your whole workspace:

- A file that could not be read when the checkpoint was taken — an editor or antivirus holding a lock, or permissions — was never captured
- At most 50 modified files are captured; anything beyond that is left out
- A changed file outside the workspace is skipped rather than captured
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

When you load a checkpoint through the interactive selector (`/checkpoint load` with no name) and the current session has messages, Nanocoder offers to create a backup checkpoint first. `/checkpoint load <name>` restores straight away, with no prompt.

## Storage

Checkpoints are stored in `.nanocoder/checkpoints/` in your project directory. Each project has its own checkpoints. Consider adding `.nanocoder/checkpoints` to your `.gitignore`. Even if you don't, checkpoints never capture the checkpoint store or the action timeline.

Snapshots skip anything matched by `.gitignore`, but deliberately ignore [`.nanocoderignore`](../configuration/index.md#ignoring-files). Hiding a file from the model's listings shouldn't quietly exclude it from restore, so a file in `.nanocoderignore` is still snapshotted and still reverted.

> **Note:** Loading a checkpoint restores files only. The conversation history saved in the checkpoint is not restored into the chat, even after a restart. To go back to an earlier conversation, use [`/resume`](session-management.md).

## Architect Mode Checkpoints

[Architect mode](development-modes.md#architect-mode) uses the same mechanism automatically. The first file-changing tool call in a turn creates an `architect-<timestamp>` checkpoint. Files that later calls in the same turn touch are added to that checkpoint before they change, so one checkpoint covers the whole turn. It is deleted once you resolve the review bar.

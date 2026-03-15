---
title: "Checkpointing"
description: "Save and restore conversation snapshots for experimenting with different approaches"
sidebar_order: 4
---

# Checkpointing

Nanocoder supports conversation checkpointing, allowing you to save snapshots of your coding sessions and restore them later. This is perfect for experimenting with different approaches or preserving important milestones.

## Checkpoint Commands

- `/checkpoint create [name]` - Create a checkpoint with optional custom name
  - Auto-generates timestamp-based name if not provided
  - Captures conversation history, modified files, and AI model configuration
  - Example: `/checkpoint create feature-auth-v1`

- `/checkpoint list` - List all available checkpoints
  - Shows checkpoint name, creation time, message count, and files changed
  - Sorted by creation date (newest first)

- `/checkpoint load [name]` - Restore files from a checkpoint
  - **Without name**: Shows interactive list to select checkpoint
  - **With name**: Directly loads the specified checkpoint
  - Prompts "Create backup before loading? (Y/n)" if current session has messages
  - Press Y (or Enter) to auto-backup, N to skip, Esc to cancel
  - Note: Conversation history restore requires restarting Nanocoder
  - Example: `/checkpoint load` (interactive) or `/checkpoint load feature-auth-v1`

- `/checkpoint delete <name>` - Delete a checkpoint permanently
  - Removes checkpoint and all associated data
  - Example: `/checkpoint delete old-checkpoint`

## What Gets Saved

- Complete conversation history
- Modified files with their content (detected via git)
- Active provider and model configuration
- Timestamp and metadata

## Storage Location

- Checkpoints are stored in `.nanocoder/checkpoints/` in your project directory
- Each project has its own checkpoints
- Consider adding `.nanocoder/checkpoints` to your `.gitignore`

## Example Workflow

```bash
# Create a checkpoint before trying a new approach
/checkpoint create before-refactor

# Make some experimental changes...
# If things go wrong, restore the checkpoint
/checkpoint load before-refactor

# Or if things went well, create a new checkpoint
/checkpoint create after-refactor

# List all checkpoints to see your progress
/checkpoint list
```

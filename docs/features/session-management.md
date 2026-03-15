---
title: "Session Management"
description: "Save and resume chat conversations automatically"
sidebar_order: 7
---

# Session Management

Nanocoder automatically saves your conversations so you can close the terminal and pick up where you left off. Sessions are saved in the background — you don't need to do anything special.

## Resuming a Session

```bash
/resume         # browse recent sessions with an interactive selector
/resume last    # jump straight into the most recent session
/resume {id}    # resume a specific session by ID
/resume {n}     # resume by list index number
```

You can also use the aliases `/sessions` or `/history`.

## What Gets Saved

Each session captures:

- Full conversation history (all messages)
- Provider and model used
- Working directory
- Timestamps and message count

Sessions are saved every 30 seconds by default and retained for 30 days.

## Storage Location

Sessions are stored in the platform-specific app data directory:

| Platform | Default Path |
|----------|-------------|
| macOS | `~/Library/Application Support/nanocoder/sessions/` |
| Linux | `~/.local/share/nanocoder/sessions/` |
| Windows | `%APPDATA%/nanocoder/sessions/` |

This can be overridden via the `directory` config option or `NANOCODER_DATA_DIR` environment variable.

## Configuration

Customize session behaviour in your `agents.config.json`:

```json
{
  "nanocoder": {
    "sessions": {
      "autoSave": true,
      "saveInterval": 30000,
      "maxSessions": 100,
      "maxMessages": 1000,
      "retentionDays": 30,
      "directory": ""
    }
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `autoSave` | `true` | Enable/disable automatic saving |
| `saveInterval` | `30000` | Milliseconds between saves (minimum 1000) |
| `maxSessions` | `100` | Maximum sessions to keep (minimum 1) |
| `maxMessages` | `1000` | Maximum messages saved per session — older messages are truncated (minimum 1) |
| `retentionDays` | `30` | Auto-delete sessions older than this (minimum 1) |
| `directory` | (platform default) | Custom storage directory |

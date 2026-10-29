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

In the selector, start typing to filter sessions by title; Backspace edits the filter, arrow keys and Enter pick a result, and Esc cancels.

### From the Command Line

You can resume a session directly at launch instead of using a slash command:

```bash
nanocoder --continue      # resume the most recent session for this directory (-c)
nanocoder --resume        # open the session picker at startup (-r)
nanocoder --resume last   # jump straight into the most recent session
nanocoder --resume {id}   # resume a specific session by ID or list index
```

`--continue` silently starts a fresh session if no previous session exists for the current directory, while `--resume` exits with an error if the requested session is not found. The two flags are mutually exclusive, and both are interactive-only — they cannot be combined with `run`. See the [CLI Options Reference](../getting-started/index.md#cli-options) for the full flag list.

## Renaming a Session

```bash
/rename <new name>    # rename the current session
```

The new name must be non-empty and **100 characters or less**. If the name exceeds this limit, an error message is displayed in chat.

## What Gets Saved

Each session captures:

- Full conversation history (all messages)
- Provider and model used
- Working directory
- Timestamps and message count
- Its artifacts: the implementation plan, the task list, and the completion walkthrough

Sessions are saved every 30 seconds by default and retained for 30 days.

## Storage Location

Sessions are stored in the platform-specific app data directory:

| Platform | Default Path |
|----------|-------------|
| macOS | `~/Library/Application Support/nanocoder/sessions/` |
| Linux | `~/.local/share/nanocoder/sessions/` |
| Windows | `%APPDATA%/nanocoder/sessions/` |

If `XDG_DATA_HOME` is set, `$XDG_DATA_HOME/nanocoder/sessions/` is used instead, on every platform. This can be overridden via the `directory` config option or `NANOCODER_DATA_DIR` environment variable.

Every Nanocoder process shares this store: other terminals, the VS Code extension, and parallel `nanocoder run`s. Updates to the session index (`sessions.json`) take a short-lived lock file, `sessions.json.lock`, so sessions saved at the same time from different processes are all kept. At startup the index is also checked against the session files on disk: a session file missing from the index is added back, and an entry whose file is gone is removed.

### Session Artifacts

Alongside `sessions/`, each session gets an `artifacts/<session id>/` directory holding the files behind the **Plan**, **Tasks**, and **Walkthrough** shortcuts above the prompt. They are written with owner-only permissions and never placed in your project directory.

- Resuming a session restores its artifact shortcuts
- Deleting a session, or letting retention expire it, deletes its artifacts too
- Directories belonging to sessions that were never saved — because `autoSave` is off, or because `/clear` retired the session id — are swept at startup once they are more than a day old
- `nanocoder --plain` runs get a session for the duration of the run and delete their artifacts on exit, so headless runs leave nothing behind

See [Development Modes](development-modes.md) for how the artifacts are produced and [Task Management](task-management.md) for the task list specifically.

### Retention and pinned sessions

Sessions not used for `retentionDays` are deleted the next time any Nanocoder process starts, and when there are more than `maxSessions`, the least recently used ones are deleted too (see [Configuration](#configuration)). A client that keeps its own list of conversations, such as an editor extension or Nanocoder Desktop, can exempt the sessions it still references:

- An ACP client calls `_nanocoder/pinSession` with `sessionId` and `pinned: true` to pin a session, and `pinned: false` to clear the mark. The session has to be saved already, which happens with its first message. Pinning never changes your configuration.
- Neither limit deletes a pinned session, and pinned sessions are not counted toward `maxSessions`, so they cannot push out unpinned recent ones. The mark survives autosave, renames and resuming.
- Deleting a pinned session, from a client (`session/delete`) or the CLI, still removes it together with its artifacts.
- `session/list` reports the mark as `_meta["nanocoder/pinned"]`, so a client can find marks it no longer needs. Clearing a mark counts as using the session, so it then gets a full `retentionDays` again.
- `initialize` reports the limits retention applies as `_meta["nanocoder/retention"]`: `{"retentionDays": 30, "maxSessions": 100}`.

Any client can clear any mark, and pinned sessions stay on disk until someone unpins or deletes them. An older Nanocoder that shares the same store and does not know about the mark can still delete a pinned session.

## Configuration

Customize session behaviour in your `nanocoder-preferences.json` (not `agents.config.json`):

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
| `autoSave` | `true` | Enable/disable automatic saving. The status line below the prompt briefly shows `saving` while a save is written |
| `saveInterval` | `30000` | Milliseconds between saves (minimum 1000) |
| `maxSessions` | `100` | Maximum sessions to keep (minimum 1) |
| `maxMessages` | `1000` | Maximum messages sent to the model (context window capping) — on-disk history is NOT truncated (minimum 1) |
| `retentionDays` | `30` | Auto-delete sessions older than this (minimum 1) |
| `directory` | (platform default) | Custom storage directory |
| `smartTitles` | `true` | Generate a descriptive title once when the opening prompt is too thin to name the session (ACP clients such as the VS Code extension; the CLI keeps its heuristic title). Manual renames are never overwritten |
| `titleModel` | (session's model) | Model used for title generation |
| `titleProvider` | (session's provider) | Provider used for title generation |

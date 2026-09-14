---
title: "Preferences"
description: "User preferences and application data directory configuration"
sidebar_order: 4
---

# User Preferences

Nanocoder automatically saves your preferences to remember your choices across sessions.

## Preferences File Locations

Preferences follow the same location hierarchy as configuration files:

1. **Project-level**: `nanocoder-preferences.json` in your current working directory (overrides user-level)
2. **User-level**: Platform-specific configuration directory:
   - **macOS**: `~/Library/Preferences/nanocoder/nanocoder-preferences.json`
   - **Linux/Unix**: `~/.config/nanocoder/nanocoder-preferences.json`
   - **Windows**: `%APPDATA%\nanocoder\nanocoder-preferences.json`

## What Gets Saved Automatically

| Preference | Description |
|------------|-------------|
| `lastProvider` | The AI provider you last selected |
| `lastModel` | The model you last used |
| `providerModels` | Your preferred model for each provider (remembered per-provider) |
| `selectedTheme` | The theme you last selected via `/settings` |
| `titleShape` | The title shape style (e.g., box, rounded) |
| `nanocoderShape` | The nanocoder ASCII art shape |
| `trustedDirectories` | Directories you've approved through the first-run security disclaimer |
| `lastUpdateCheck` | Timestamp of the last update check (used to avoid checking too frequently) |
| `alternateScreen` | When `true`, starts in fullscreen mode (alternate screen buffer with in-app scrolling) by default. The `--alt-screen`/`--no-alt-screen` CLI flags override this for a single run. See [CLI Options](../getting-started/index.md#cli-options). |

### Paste Configuration

The paste threshold is also stored in the preferences file under the `nanocoder.paste` namespace:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `nanocoder.paste.singleLineThreshold` | number | `800` | Maximum characters for a single-line paste to be inserted directly. Longer or multi-line pastes become `[Paste #N: X chars]` placeholders. |

You can change this via `/settings` → **Paste Threshold**, or by editing the file directly:

```json
{
  "nanocoder": {
    "paste": {
      "singleLineThreshold": 1500
    }
  }
}
```

### Reasoning Traces

Expanding reasoning traces can also be configured in the preferences file with the `reasoningExpanded` field:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `reasoningExpanded` | boolean | `false` | When set to true, displays the full reasoning traces of models which support thinking |

You can change this by editing the preferences file directly:

```json
{
  "reasoningExpanded": true
}
```

Reasoning traces can also be toggled dynamically with the Ctrl+R keyboard shortcut.

### Notification Configuration

Desktop notification preferences are stored under the `nanocoder.notifications` namespace:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `nanocoder.notifications.enabled` | boolean | `false` | Enable desktop notifications |
| `nanocoder.notifications.sound` | boolean | `false` | Play a sound with notifications |
| `nanocoder.notifications.events.toolConfirmation` | boolean | `true` | Notify when a tool needs approval |
| `nanocoder.notifications.events.questionPrompt` | boolean | `true` | Notify when the AI asks a question |
| `nanocoder.notifications.events.generationComplete` | boolean | `true` | Notify when a response is ready |

You can change these via `/settings` → **Notifications**. See [Desktop Notifications](../features/notifications.md) for full details including platform-specific setup.

### CI Watch Configuration

Background CI-watch preferences are stored under the `nanocoder.ciWatch` namespace. When enabled, the daemon (`nanocoder daemon start`) polls GitHub Actions for failures on the current branch and automatically investigates them:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `nanocoder.ciWatch.enabled` | boolean | `false` | Enable background CI-watch polling. Requires the `gh` CLI to be installed and authenticated. |
| `nanocoder.ciWatch.pollIntervalMs` | number | `30000` | Base interval between polls, in milliseconds. |
| `nanocoder.ciWatch.maxPollIntervalMs` | number | `300000` | Backoff ceiling applied when consecutive `gh` calls fail. |

There's no `/settings` wizard for this yet — set it by hand-editing the preferences file:

```json
{
  "nanocoder": {
    "ciWatch": {
      "enabled": true,
      "pollIntervalMs": 30000
    }
  }
}
```

### Project-Level Verify Policy (`agents.config.json`)

Whether CI-watch investigations can auto-fix a failure — and how aggressively — is a project policy, not a personal preference, so it lives in the project's own committed `agents.config.json` under `nanocoder.verify` instead:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `nanocoder.verify.trustLevel` | `"comment-only"` \| `"auto-fix"` \| `"full-commit"` | `comment-only` | See `nanocoder daemon start --trust` below. |
| `nanocoder.verify.pollIntervalMs` | number | — | Overrides `ciWatch.pollIntervalMs` above when set. |
| `nanocoder.verify.maxPollIntervalMs` | number | — | Overrides `ciWatch.maxPollIntervalMs` above when set. |

```json
{
  "nanocoder": {
    "verify": {
      "trustLevel": "auto-fix"
    }
  }
}
```

`nanocoder daemon start --trust <comment-only|auto-fix|full-commit>` overrides this for a single run; the config value is used when the flag is omitted, falling back to `comment-only` if neither is set:

- **`comment-only`** (default) — investigates and diagnoses a CI failure, posting the diagnosis as a PR comment. Never mutates anything.
- **`auto-fix`** — additionally implements and commits a fix in an isolated `git worktree`, then pushes a new branch and opens a **draft PR** for human review. The original failing branch is never touched directly.
- **`full-commit`** — pushes the fix **directly to the failing branch**, with no draft PR and no review step. `daemon start --trust full-commit` shows a one-time security warning per project before starting; subsequent starts for the same project skip it.

When you restart Nanocoder, it automatically restores your last provider, model, theme, shape, paste threshold, and notification preferences.

## Manual Management

- View current preferences: The file is human-readable JSON
- Reset preferences: Delete any `nanocoder-preferences.json` to start fresh

## Application Data Directory

Nanocoder stores internal application data (such as usage statistics) in a separate application data directory:

- **macOS**: `~/Library/Application Support/nanocoder`
- **Linux/Unix**: `$XDG_DATA_HOME/nanocoder` or `~/.local/share/nanocoder`
- **Windows**: `%APPDATA%\nanocoder`

You can override this directory using `NANOCODER_DATA_DIR`.

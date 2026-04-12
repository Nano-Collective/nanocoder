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

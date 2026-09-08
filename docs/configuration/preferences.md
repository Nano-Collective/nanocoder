---
title: "Preferences"
description: "User preferences and application data directory configuration"
sidebar_order: 4
---

# User Preferences

Nanocoder automatically saves your preferences to remember your choices across sessions.

## Editing Preferences with `/settings`

You should rarely need to edit these files by hand. `/settings` opens an in-TUI editor covering everything on this page, grouped into six tabs:

- **Appearance** - theme, title shape, nanocoder ASCII shape, alternate screen mode
- **Input** - paste threshold, desktop notifications
- **Behavior** - tool results and thinking display, reasoning traces, default mode, auto-compact, session autosave
- **Providers** - configure providers, web search, tool auto-approval
- **MCP** - configure MCP servers
- **Advanced** - privacy, direct config file editing, environment, model tuning, IDE connection

Jump straight to a tab with `/settings <tab>`, e.g. `/settings providers`.

The rest of this page documents the underlying file format, for scripted setups and for anything you'd rather edit directly.

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
| `selectedTheme` | The theme you last selected via `/settings`. Also colours syntax highlighting in code blocks, diffs, and file previews |
| `syntaxTheme` | Optional. Name of the theme whose palette colours syntax highlighting, when you want code to keep a palette of its own (e.g. `"dracula"`) instead of following `selectedTheme`. Any theme name from `/settings` → **Theme** works; an unknown name falls back to `selectedTheme` |
| `titleShape` | The title shape style (e.g., box, rounded) |
| `nanocoderShape` | The nanocoder ASCII art shape |
| `trustedDirectories` | Directories you've approved through the first-run security disclaimer |
| `lastUpdateCheck` | Timestamp of the last update check (used to avoid checking too frequently) |
| `semanticMemoryEnabled` | Enables semantic memory across sessions. Set to `false` or use `/settings` → **Advanced** → **Semantic Memory** to keep agents stateless. |
| `semanticMemoryTokenBudget` | Approximate token ceiling for the recalled `## Project Context` block. Default `240`, clamped to 40-4000. Adjustable from `/settings` → **Advanced**. |
| `semanticMemoryLimit` | Maximum memories considered for a single prompt. Default `8`, clamped to 1-50. Adjustable from `/settings` → **Advanced**. |
| `alternateScreen` | When `true`, starts in fullscreen mode (alternate screen buffer with in-app scrolling) by default. The `--alt-screen`/`--no-alt-screen` CLI flags override this for a single run. See [CLI Options](../getting-started/index.md#cli-options). |

### Paste Configuration

The paste threshold is also stored in the preferences file under the namespaced `nanocoder.paste` key:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `nanocoder.paste.singleLineThreshold` | number | `800` | Maximum characters for a single-line paste to be inserted directly. Longer or multi-line pastes become `[Paste #N: X chars]` placeholders. |

You can change this via `/settings` → **Input** → **Paste Threshold**, or by editing the file directly:

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

You can change this via `/settings` → **Behavior** → **Reasoning Traces**, or by editing the preferences file directly:

```json
{
  "reasoningExpanded": true
}
```

Reasoning traces can also be toggled dynamically with the Ctrl+R keyboard shortcut.

### Usage and Cost Footer

Each assistant message ends with a gray footer showing provider-reported token counts and the estimated cost of that response. Turn it off with the `showUsageFooter` field:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `showUsageFooter` | boolean | `true` | When false, assistant messages render with no footer line at all - neither the provider-reported tokens and cost, nor the client-side token estimate |

You can change this via `/settings` → **Behavior** → **Tool Results and Thinking**, or by editing the preferences file directly:

```json
{
  "showUsageFooter": false
}
```

The setting is read per message, so toggling it applies from the next response onwards - no restart needed. It also applies to replayed history when you resume a session and to subagent transcripts.

### Professional Tone

Professional ("boring") tone is stored in the preferences file with the `professionalTone` field:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `professionalTone` | boolean | `false` | When true, progress text is strictly functional (`Completed in 12s.` instead of `Worked for a plucky 12s.`) and the system prompt gains a TONE section telling the model to be terse — no filler, no preamble, no celebratory wrap-ups. |

You can change this via `/settings` → **Behavior** → **Professional Tone**, or by editing the preferences file directly:

```json
{
  "professionalTone": true
}
```

Toggling it from `/settings` applies to both halves straight away - the progress text on the next turn, and the TONE section on the next system prompt rebuild, which the toggle itself triggers. Editing the preferences file by hand needs a restart, since nothing is watching the file.

Under the `nano` tool profile the TONE section is swapped for a shortened variant, the same way every other section is slimmed for tiny models.

One exception: if you have replaced the system prompt entirely with a [`systemPrompt` override](index.md#custom-system-prompt) in `mode: "replace"`, the TONE section is not added - your override is used verbatim. The progress text still changes. In `mode: "append"` the section is kept, and your appended text lands after it, so your wording wins on any conflict.

### Notification Configuration

Desktop notification preferences are stored under the top-level `notifications` key:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `notifications.enabled` | boolean | `false` | Enable desktop notifications |
| `notifications.sound` | boolean | `false` | Play a sound with notifications |
| `notifications.bell` | boolean | `false` | Also ring the terminal bell (works over SSH / tmux) |
| `notifications.events.toolConfirmation` | boolean | `true` | Notify when a tool needs approval |
| `notifications.events.questionPrompt` | boolean | `true` | Notify when the AI asks a question |
| `notifications.events.generationComplete` | boolean | `true` | Notify when a response is ready |
| `notifications.events.triggeredRunComplete` | boolean | `true` | Notify when a daemon-triggered skill run finishes |

You can change these via `/settings` → **Input** → **Notifications**. See [Desktop Notifications](../features/notifications.md) for full details including platform-specific setup.

When you restart Nanocoder, it automatically restores your last provider, model, theme, shape, paste threshold, and notification preferences.

## Manual Management

- View current preferences: The file is human-readable JSON
- Reset preferences: Delete any `nanocoder-preferences.json` to start fresh

## Application Data Directory

Nanocoder stores internal application data (such as usage statistics) in a separate application data directory:

- **macOS**: `~/Library/Application Support/nanocoder`
- **Linux/Unix**: `$XDG_DATA_HOME/nanocoder` or `~/.local/share/nanocoder`
- **Windows**: `%APPDATA%\nanocoder`

You can override this directory using `NANOCODER_DATA_DIR`. Lifetime `/stats` data is stored in `stats.json` in this directory. Older `.nanocoder-stats.json` files are migrated automatically on first read.

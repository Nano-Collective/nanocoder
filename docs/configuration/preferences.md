---
title: "Preferences"
description: "User preferences and application data directory configuration"
sidebar_order: 4
---

# User Preferences

Nanocoder automatically saves your preferences to remember your choices across sessions.

## Editing Preferences with `/settings`

You should rarely need to edit these files by hand. `/settings` opens an in-TUI editor covering everything on this page, grouped into six tabs:

- **Appearance** - theme, title shape, nanocoder ASCII shape, alternate screen mode, mouse wheel reporting
- **Input** - paste threshold, desktop notifications
- **Behavior** - tool results and thinking display, reasoning traces, professional tone, default mode, auto-compact, session autosave
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
   - **Linux/Unix**: `~/.config/nanocoder/nanocoder-preferences.json` (respects `XDG_CONFIG_HOME`)
   - **Windows**: `%APPDATA%\nanocoder\nanocoder-preferences.json`

When a project-level file exists, Nanocoder both reads preferences from it and writes preference changes (last model, theme and so on) back to it, so avoid committing one unless you mean to share those choices.

**Directory trust is global only.** `trustedDirectories` is always read from, and written to, the user-level file. A `trustedDirectories` entry in a project-level `nanocoder-preferences.json` is ignored, so a cloned repository cannot mark itself trusted and skip the security disclaimer that gates its MCP servers and hooks.

If `NANOCODER_CONFIG_DIR` is set, the project-level file is skipped for top-level preferences, which are read from and written to `nanocoder-preferences.json` in that directory. The namespaced `nanocoder.sessions` and `nanocoder.paste` blocks are the exception: they are still read from a project-level file first. If no user-level file exists yet, an empty one is created the first time preferences are resolved.

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
| `trustedDirectories` | Directories you've approved through the security disclaimer (user-level file only). Each entry is `{ "path": "/absolute/folder", "fingerprint": "<sha256>" }`. The fingerprint covers that folder's plugins (`.nanocoder/plugins/*.mjs`), hooks, formatters, `lspServers`, `.mcp.json`, custom tools, and skills, agents, and commands with `subscribe:` triggers. It also covers the project `.env` (by content), the `agents.config.json` settings that relax confirmations (`nanocoder.alwaysAllow`, `nanocoder.defaultMode`, `nanocoder.sandbox`, `nanocoder.verify.trustLevel`), and the `baseUrl` of each project provider. Each of these counts only when present, so a folder without them keeps the same fingerprint. It does not cover files a plugin imports or scripts a hook runs, so edits to those are not asked about. A change asks again. A plain path saved before fingerprints is asked again too, with a note that the upgrade needs re-approval. **Before downgrading to 1.31 or earlier, remove the `{ path, fingerprint }` entries from `trustedDirectories`.** Those versions throw on the object entries, which breaks the trust check for every folder, not just the fingerprinted ones. A project `.env` cannot set `NANOCODER_TRUST_DIRECTORY`, `NANOCODER_CONFIG_DIR`, `NANOCODER_MCPSERVERS`, `NANOCODER_MCPSERVERS_FILE`, or `NANOCODER_CI_TRUST_LEVEL`: it is read before the trust check, so those are ignored (with a warning) unless they come from your shell environment. |
| `lastUpdateCheck` | Timestamp of the last successful update check. Automatic checks wait 24 hours before checking again |
| `semanticMemoryEnabled` | Enables semantic memory across sessions. Set to `false` or use `/settings` → **Advanced** → **Semantic Memory** to keep agents stateless. |
| `semanticMemoryTokenBudget` | Approximate token ceiling for the recalled `## Project Context` block. Default `240`, clamped to 40-4000. Adjustable from `/settings` → **Advanced**. |
| `semanticMemoryLimit` | Maximum memories considered for a single prompt. Default `8`, clamped to 1-50. Adjustable from `/settings` → **Advanced**. |
| `alternateScreen` | When `true` (default), starts in fullscreen mode (alternate screen buffer with in-app scrolling). Set to `false` or pass `--no-alt-screen` to force inline mode. See [CLI Options](../getting-started/index.md#cli-options). |
| `mouseReporting` | When `true` (default), the terminal reports mouse wheel ticks in fullscreen mode so the wheel scrolls the chat viewport; select text with Shift+drag (Option+drag in iTerm2). Set to `false` for native click-drag selection, at the cost of wheel scrolling. Switchable with `--mouse` / `--no-mouse` or `/settings` → **Appearance** → **Mouse Wheel Reporting**. |
| `compactToolDisplay` | When `true` (default), tool results render in compact form. Ctrl+O toggles it for the current session without saving. In `/settings` → **Behavior** → **Tool Results and Thinking** this appears as **Expand Tool Results by default**, which is the inverse of this value. |
| `tune` | The settings last applied with `/tune` (tool profile, tool-calling mode, model parameters). A `nanocoder.tune` block in `agents.config.json` takes priority; see [Tune](../features/tune.md). |
| `enablePromptScrubbing` | When `true`, sensitive identifiers are replaced with placeholders in everything sent to the provider - prompts, the system prompt, tool results (including `structuredContent`) and assistant tool-call arguments - and rehydrated to real values in the response. Applies in the TUI, `--plain`, ACP / VS Code, subagents and compaction. File paths and URLs are left in the clear so tools keep working. Default `false`. Toggle with `/settings` → **Advanced** → **Privacy**; preview what would be scrubbed with `/privacy inspect <text>`. |

### Paste Configuration

The paste threshold is also stored in the preferences file under the namespaced `nanocoder.paste` key:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `nanocoder.paste.singleLineThreshold` | number | `800` | Maximum characters for a single-line paste to be inserted directly. Longer pastes become `[Paste #N: X chars]` placeholders, and multi-line pastes become `[Paste #N: X lines]`. |

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

### TUI Frame Rate (maxFps)

For slower terminals (such as remote SSH sessions, Windows Terminal over remote connections, or tmux) and resource-constrained CPUs, you can configure Ink's maximum TUI rendering frame rate with the `nanocoder.ui.maxFps` setting:

| Option | Type | Default | Accepted Range | Description |
|--------|------|---------|----------------|-------------|
| `nanocoder.ui.maxFps` | number (integer) | `30` | `1` – `60` | Maximum frames per second for Ink terminal UI updates. Lowering this value (e.g., to 10 or 15) reduces CPU load and terminal redraw overhead on low-power devices. |

When omitted or set to an invalid value (such as non-integers, numbers below 1, or numbers above 60), Nanocoder safely rejects the invalid value and preserves Ink's default behavior of 30 FPS.

You can configure this by editing your preferences file (`nanocoder-preferences.json`):

```json
{
  "nanocoder": {
    "ui": {
      "maxFps": 15
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

Reasoning traces can also be toggled dynamically with the Ctrl+N keyboard shortcut.

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

### Agent Bash Output

By default, a completed card for a command the agent runs shows the command and its status. The command output is not kept on the card. Set `showAgentBashOutput` to keep the output on the card regardless of `compactToolDisplay` being true or false:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `showAgentBashOutput` | boolean | `false` | When true, a completed card for a command the agent runs shows the command output. This applies whether compact tool display is on or off, and also covers failed commands. |

You can change this via `/settings` → **Behavior** → **Tool Results and Thinking**, or by editing the preferences file directly:

```json
{
  "showAgentBashOutput": true
}
```

This setting only affects commands the agent runs. Output for commands you type yourself with `!command` is always shown. Toggling it from `/settings` applies from the next command onwards, with no restart needed. Editing the preferences file by hand needs a restart.

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

Any event you leave out of `notifications.events` keeps its default of `true`, so `{"notifications": {"enabled": true}}` turns on every event.

You can change these via `/settings` → **Input** → **Notifications**. See [Desktop Notifications](../features/notifications.md) for full details including platform-specific setup.

### CI Watch Configuration

Background CI-watch preferences are stored under the top-level `ciWatch` key of your **global** preferences file (a project-level `nanocoder-preferences.json` is ignored for this key, since turning on background polling is a personal decision). When enabled, the daemon (`nanocoder daemon start`) polls GitHub Actions for failures on the current branch and automatically investigates them:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ciWatch.enabled` | boolean | `false` | Enable background CI-watch polling. Requires the `gh` CLI to be installed and authenticated. |
| `ciWatch.pollIntervalMs` | number | `30000` | Base interval between polls, in milliseconds. |
| `ciWatch.maxPollIntervalMs` | number | `300000` | Backoff ceiling applied when consecutive `gh` calls fail. |

There's no `/settings` wizard for this yet — set it by hand-editing the preferences file:

```json
{
  "ciWatch": {
    "enabled": true,
    "pollIntervalMs": 30000
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
- **`auto-fix`** — additionally implements and commits a fix in an isolated `git clone`, then pushes a new branch and opens a **draft PR** for human review. The original failing branch is never touched directly.
- **`full-commit`** — pushes the fix **directly to the failing branch**, with no draft PR and no review step. `daemon start --trust full-commit` shows a one-time security warning per project before starting; subsequent starts for the same project skip it.

When you restart Nanocoder, it automatically restores your last provider, model, theme, shape, paste threshold, and notification preferences.

## Manual Management

- View current preferences: The file is human-readable JSON
- Reset preferences: Delete any `nanocoder-preferences.json` to start fresh

## Application Data Directory

Nanocoder stores internal application data (such as usage statistics) in a separate application data directory:

- **macOS**: `~/Library/Application Support/nanocoder`
- **Linux/Unix**: `~/.local/share/nanocoder`
- **Windows**: `%APPDATA%\nanocoder`

If `XDG_DATA_HOME` is set, `$XDG_DATA_HOME/nanocoder` is used instead on every platform, including macOS and Windows. `NANOCODER_DATA_DIR` overrides both. Lifetime `/stats` data is stored in `stats.json` in this directory. Older `.nanocoder-stats.json` files are migrated automatically on first read.

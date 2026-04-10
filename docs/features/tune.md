---
title: "Tune"
description: "Runtime model tuning for tool profiles, compaction, native tool calling, and model parameters"
sidebar_order: 11
---

# Tune

The `/tune` command opens a modal UI for adjusting runtime model behaviour. It lets you change tool profiles, compaction strategy, native tool calling, and model parameters — all without restarting your session.

Settings are persisted to `nanocoder-preferences.json` and restored on next launch.

## Opening Tune

Type `/tune` in the chat input. Use arrow keys to navigate, **Enter** to select, and **Esc** to cancel.

## Settings

### Enabled / Disabled

The top menu item toggles tune on or off. When disabled, all settings revert to defaults. When enabled, the full settings menu appears.

### Tool Profile

Controls which tools the AI has access to.

| Profile | Tools | Behaviour |
|---------|-------|-----------|
| **full** (default) | All registered tools including MCP servers | No filtering applied |
| **minimal** | 8 core tools: `read_file`, `write_file`, `string_replace`, `execute_bash`, `find_files`, `search_file_contents`, `list_directory`, `agent` | Slim prompt and single-tool enforcement enabled automatically |

The **minimal** profile is designed for small models (1B-8B parameters) that struggle with large tool sets. It reduces the system prompt size and forces the model to call one tool at a time.

### Aggressive Compact

When enabled, sets the auto-compact threshold to 40% and mode to `aggressive`. This compresses conversation history more frequently and aggressively — useful for models with small context windows.

### Native Tool Calling

Toggle native tool calling on or off. When disabled, tools are described in the system prompt and the model uses XML fallback for tool calls instead of the provider's native tool calling API. This can help with models that have unreliable native tool support.

### Model Parameters

Fine-tune the model's generation parameters:

| Parameter | Range | Description |
|-----------|-------|-------------|
| **Temperature** | 0.1 - 2.0 | Controls randomness. Lower = more focused, higher = more creative |
| **Top P** | 0 - 1.0 | Nucleus sampling. Lower = fewer token choices considered |
| **Top K** | 1 - 200 | Limits token choices to top K candidates |
| **Max Tokens** | 64 - 32768 | Maximum response length |
| **Frequency Penalty** | -2.0 - 2.0 | Penalises repeated tokens. Higher = less repetition |
| **Presence Penalty** | -2.0 - 2.0 | Penalises tokens already used. Higher = more topic diversity |

Press **Enter** on a parameter to cycle through values. Select **Reset All to Defaults** to clear all parameter overrides.

## Presets

Two built-in presets are available via **Load Preset**:

| Preset | Settings |
|--------|----------|
| **Default** | Resets everything to defaults (tune disabled) |
| **Small Model** | Minimal tool profile, aggressive compact, temperature 0.7 |

Selecting a preset populates the tune form — you can further adjust settings before applying.

## Configuration Layers

Tune settings resolve from a 5-layer hierarchy (highest priority wins):

1. **Hardcoded defaults** — `enabled: false`, `toolProfile: 'full'`, `aggressiveCompact: false`
2. **Top-level config** — `tune` in `agents.config.json`
3. **Per-provider config** — `tune` within a provider's configuration
4. **Preferences** — saved via the `/tune` UI to `nanocoder-preferences.json`
5. **Session override** — runtime changes in the current session

### Example: Per-Provider Config

Set defaults for a specific provider in `agents.config.json`:

```json
{
  "providers": {
    "ollama": {
      "name": "Ollama",
      "type": "ollama",
      "models": ["qwen2.5-coder:7b"],
      "tune": {
        "enabled": true,
        "toolProfile": "minimal",
        "aggressiveCompact": true
      },
      "config": {
        "baseURL": "http://localhost:11434/v1"
      }
    }
  }
}
```

This automatically activates tune with the minimal profile whenever you switch to the Ollama provider.

## Interaction with Development Modes

Tune works alongside [development modes](development-modes.md):

- **Plan mode + minimal profile** — the model gets 4 exploration tools (`read_file`, `find_files`, `search_file_contents`, `list_directory`), making it practical for small models to plan
- **Plan mode + full profile** — all plan-mode tools are available, including read-only git, diagnostics, web, and interaction tools
- Mode exclusions are filtered on top of the tune profile

## Status Bar

When tune is active, the status bar shows a summary of your settings:

```
tune: minimal | compact | temp:0.7
```

On narrow terminals, this is shortened to just the profile name.

## Related

- [Development Modes](development-modes.md) — normal, auto-accept, yolo, and plan modes
- [Context Compression](context-compression.md) — how compaction works
- [Commands Reference](commands.md) — all slash commands
- [Configuration](../configuration/index.md) — `agents.config.json` reference

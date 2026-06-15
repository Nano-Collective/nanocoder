---
title: "Configuration"
description: "Configure Nanocoder providers, preferences, and settings"
sidebar_order: 5
---

# Configuration

Nanocoder is configured through JSON files that control AI providers, MCP servers, user preferences, and more.

## Configuration File Locations

Nanocoder looks for configuration in the following order (first found wins):

1. **Project-level** (highest priority): `agents.config.json` in your current working directory
   - Use this for project-specific providers, models, or API keys
   - Perfect for team sharing or repository-specific configurations

2. **User-level**: Platform-specific configuration directory
   - **macOS**: `~/Library/Preferences/nanocoder/agents.config.json`
   - **Linux/Unix**: `~/.config/nanocoder/agents.config.json` (respects `XDG_CONFIG_HOME`)
   - **Windows**: `%APPDATA%\nanocoder\agents.config.json`
   - Your global default configuration

> **Note:** When `NANOCODER_CONFIG_DIR` is set, it takes full precedence — the project-level and home directory checks are skipped, and Nanocoder looks for `agents.config.json` only in the specified directory.

> **Tip:** Use `/setup-config` to list all available configuration files and open any of them in your `$EDITOR`.

## Environment Variables

Keep API keys out of version control using environment variables. Variables are loaded from shell environment (`.bashrc`, `.zshrc`) or `.env` file in your working directory.

### General

| Variable | Description |
|----------|-------------|
| `NANOCODER_CONFIG_DIR` | Override the global configuration directory (skips all other config lookups) |
| `NANOCODER_CONTEXT_LIMIT` | Default context limit (tokens) used when no session override or provider context config applies and the model is not resolved from models.dev. Enables auto-compact and `/usage` to work correctly. Can also be set via the `--context-max` CLI flag (which takes priority) |
| `NANOCODER_DATA_DIR` | Override the application data directory for internal data like usage statistics |
| `NANOCODER_INSTALL_METHOD` | Override installation detection (`npm`, `homebrew`, `nix`, `unknown`) |
| `NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT` | Graceful shutdown timeout in milliseconds (default: 5000) |
| `NANOCODER_MAX_TURNS` | Maximum LLM turns for headless runs (`--plain` and ACP). Overrides `nanocoder.headless.maxTurns`; default 200. See [Headless](#headless) |

### Provider & MCP Overrides

Override provider and MCP server configurations via environment variables. These take highest precedence over project-level and global config files.

| Variable | Description |
|----------|-------------|
| `NANOCODER_PROVIDERS` | JSON string of provider configurations (overrides all config files) |
| `NANOCODER_PROVIDERS_FILE` | Path to a JSON file containing provider configurations (used if `NANOCODER_PROVIDERS` is not set) |
| `NANOCODER_MCPSERVERS` | JSON string of MCP server configurations (overrides all config files) |
| `NANOCODER_MCPSERVERS_FILE` | Path to a JSON file containing MCP server configurations (used if `NANOCODER_MCPSERVERS` is not set) |

See [Providers](providers/index.md) and [MCP Configuration](mcp-configuration.md) for format details and examples.

### Logging

These are covered in detail on the [Logging](logging.md) page.

| Variable | Description |
|----------|-------------|
| `NANOCODER_LOG_LEVEL` | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `NANOCODER_LOG_TO_FILE` | Enable file logging (`true`/`false`) |
| `NANOCODER_LOG_DISABLE_FILE` | Disable file logging (`true` to disable) |
| `NANOCODER_LOG_DIR` | Override log directory |
| `NANOCODER_LOG_TRANSPORTS` | Configure logging transports (comma-separated) |
| `NANOCODER_CORRELATION_ENABLED` | Enable/disable correlation tracking (default: `true`) |
| `NANOCODER_CORRELATION_DEBUG` | Enable debug logging for correlation tracking |

### Environment Variable Substitution

You can reference environment variables in your configuration files using substitution syntax:

**Syntax:** `$VAR_NAME`, `${VAR_NAME}`, or `${VAR_NAME:-default}`

Substitution is applied recursively to all string fields in provider and MCP server configurations — any string value can reference environment variables, not just specific fields.

See `.env.example` for setup instructions.

## Context Limit Resolution Order

Nanocoder resolves a model's context limit in this order:

1. Session override from `/context-max` or `--context-max`
2. Provider `contextWindows[model]` in `agents.config.json`
3. Provider `contextWindow` in `agents.config.json`
4. `NANOCODER_CONTEXT_LIMIT`
5. models.dev metadata
6. Built-in Ollama fallback map

This lets you persist context limits for unknown or local models without reapplying `/context-max` every session.

## Application Settings

Beyond providers and MCP servers, `agents.config.json` supports application-level settings under the `nanocoder` key.

### Auto-Compact

Automatically compress context when it reaches a percentage of the model's context limit. See [Context Compression](../features/context-compression.md) for full details on how compression works.

```json
{
  "nanocoder": {
    "autoCompact": {
      "enabled": true,
      "threshold": 60,
      "strategy": "llm",
      "mode": "conservative",
      "notifyUser": true
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable automatic compression |
| `threshold` | number | `60` | Context usage percentage to trigger compression (50–95) |
| `strategy` | string | `"llm"` | Compaction strategy: `"llm"` (model writes a structured summary) or `"mechanical"` (regex truncation) |
| `mode` | string | `"conservative"` | Mechanical compression mode: `"default"`, `"conservative"`, `"aggressive"` (ignored when strategy is `"llm"`) |
| `notifyUser` | boolean | `true` | Show a notification when auto-compact runs |

You can also override these per-session with `/compact --auto-on`, `/compact --auto-off`, `/compact --threshold <n>`, and `/compact --strategy llm|mechanical`.

### Sessions

Configure automatic session saving and retention. See [Session Management](../features/session-management.md) for usage details.

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

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoSave` | boolean | `true` | Enable/disable automatic session saving |
| `saveInterval` | number | `30000` | Milliseconds between saves (minimum 1000) |
| `maxSessions` | number | `100` | Maximum sessions to keep (minimum 1) |
| `maxMessages` | number | `1000` | Maximum messages sent to the model in interactive/headless chat (minimum 1). Preserves on-disk history and system messages, capping only the context window. |
| `retentionDays` | number | `30` | Auto-delete sessions older than this (minimum 1) |
| `directory` | string | (platform default) | Custom storage directory for session files |

### Headless

Limits for non-interactive runs — the `--plain` shell (used in CI and non-TTY environments) and the ACP loop. There is no human to stop a wedged model in these runs, so the conversation loop caps the number of LLM turns.

When the cap is reached, the loop does **not** error out and discard work. On the final turn it strips all tools and asks the model to produce its answer using only the information it already has, so the run ends with a usable result.

```json
{
  "nanocoder": {
    "headless": {
      "maxTurns": 200
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxTurns` | number | `200` | Maximum LLM turns before the loop forces a final, tool-free answer (minimum 1). Raise it for long iterative jobs; the `NANOCODER_MAX_TURNS` env var takes precedence over this setting. |

One turn is a single LLM response plus its batch of tool executions. The default of 200 is high enough for long iterative jobs to finish while still bounding cost and wall-clock time for an unattended run that gets stuck.

### Paste Handling

Configure how pasted text is handled in the input. By default, single-line pastes of 800 characters or fewer are inserted directly, while longer or multi-line pastes are collapsed into a `[Paste #N: X chars]` placeholder.

You can change the threshold interactively via `/settings` → **Paste Threshold**, or by editing `nanocoder-preferences.json` directly:

```json
{
  "nanocoder": {
    "paste": {
      "singleLineThreshold": 800
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `singleLineThreshold` | number | `800` | Maximum characters for a single-line paste to be inserted directly. Pastes longer than this (or multi-line pastes) become placeholders. Must be a positive integer. |

This setting is stored in `nanocoder-preferences.json` (see [Preferences](preferences.md) for file locations).

### Default Development Mode

Set the initial development mode for all new interactive sessions. Without this setting, Nanocoder always starts in **normal** mode. Once a session begins, you can still switch modes at any time using `/mode`.

```json
{
  "nanocoder": {
    "defaultMode": "plan"
  }
}
```

| Value | Description |
|-------|-------------|
| `"normal"` | Standard mode — all tool calls require approval |
| `"auto-accept"` | Semi-automatic — read-only and safe tools auto-run; writes and bash prompts |
| `"yolo"` | Fully automatic — no confirmations at all |
| `"plan"` | Read-only exploration mode — only read/search/list tools available |

The `--mode` CLI flag always takes precedence over this config value. Non-interactive runs (`nanocoder run ...`) always default to `auto-accept` regardless of this setting.

### Tool Auto-Approval

Allow specific tools to run without confirmation, even in normal development mode. The `alwaysAllow` array accepts tool names — listed tools execute immediately without prompting for approval, and the same list also applies to non-interactive runs (`nanocoder run ...`).

```json
{
  "nanocoder": {
    "alwaysAllow": ["execute_bash", "read_file", "find_files"]
  }
}
```

### Disabling Tools

Turn off individual tools globally with the top-level `disabledTools` array. Listed tools are filtered out everywhere the model could ask for them — chat, [subagents](../features/subagents.md), and every [`/tune` profile](../features/tune.md). The model is told they don't exist, so it won't try to call them.

```json
{
  "nanocoder": {
    "disabledTools": ["execute_bash", "web_search"]
  }
}
```

Names match the registered tool ids (`read_file`, `write_file`, `string_replace`, `execute_bash`, `web_search`, `fetch_url`, `agent`, etc.). [MCP](mcp-configuration.md) tools follow the same naming as in their server config.

Resolution: project-level `agents.config.json` wins over the global config. The list is layered on top of `/tune` profiles and mode exclusions — if `nano` profile would otherwise expose `read_file`, listing it in `disabledTools` removes it. Subagents respect the global list even if their own `tools` allow-list includes the disabled name.

### Custom System Prompt

Override or extend the built-in system prompt with your own. Useful when running small or context-constrained models where the default prompt consumes too many tokens, or when you want to specialize Nanocoder for a non-coding workflow.

The simplest form replaces the entire built-in prompt with inline content:

```json
{
  "nanocoder": {
    "systemPrompt": {
      "content": "You are an AI model running on CPU. Be concise."
    }
  }
}
```

Or load the prompt from a file (path is resolved relative to the working directory unless absolute):

```json
{
  "nanocoder": {
    "systemPrompt": {
      "mode": "replace",
      "file": "./.nanocoder/system-prompt.md"
    }
  }
}
```

Use `"mode": "append"` to keep the built-in prompt and add your text at the end:

```json
{
  "nanocoder": {
    "systemPrompt": {
      "mode": "append",
      "content": "Always respond in British English."
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | string | `"replace"` | `"replace"` overrides the built-in prompt entirely (no system info, no AGENTS.md). `"append"` adds your content after the built-in prompt. |
| `content` | string | — | Inline prompt text. Takes priority over `file` if both are set. |
| `file` | string | — | Path to a markdown/text file containing the prompt. Resolved relative to the working directory if not absolute. |

**Notes:**
- In `replace` mode, the built-in `## SYSTEM INFORMATION` section and AGENTS.md auto-append are skipped — include them yourself if you need them.
- Tool definitions are still injected into the prompt for providers that don't support native tool calling. Tool availability is controlled separately via `disabledTools` and `/tune`.
- If the file can't be read, Nanocoder logs a warning and falls back to the built-in prompt.
- Project-level `agents.config.json` wins over the global config.

### Web Search

The `web_search` tool uses the [Brave Search API](https://brave.com/search/api/) and requires an API key to enable. Without a key, the tool is not registered and won't be available to the model.

Brave's free tier includes 2,000 queries per month. [Get an API key here](https://brave.com/search/api/).

```json
{
  "nanocoder": {
    "nanocoderTools": {
      "webSearch": {
        "apiKey": "$BRAVE_SEARCH_API_KEY"
      }
    }
  }
}
```

The `apiKey` field supports environment variable substitution (`$VAR`, `${VAR}`, `${VAR:-default}`), so you can keep the actual key in your environment rather than in the config file.

## Sections

- [Providers](providers/index.md) - AI provider setup and configuration
- [MCP Configuration](mcp-configuration.md) - Model Context Protocol server integration
- [Preferences](preferences.md) - User preferences and application data
- [Logging](logging.md) - Structured logging with Pino

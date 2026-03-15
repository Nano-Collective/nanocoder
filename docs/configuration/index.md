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

## Environment Variables

Keep API keys out of version control using environment variables. Variables are loaded from shell environment (`.bashrc`, `.zshrc`) or `.env` file in your working directory.

### General

| Variable | Description |
|----------|-------------|
| `NANOCODER_CONFIG_DIR` | Override the global configuration directory (skips all other config lookups) |
| `NANOCODER_CONTEXT_LIMIT` | Default context limit (tokens) for models not found on models.dev. Enables auto-compact and `/usage` to work correctly |
| `NANOCODER_DATA_DIR` | Override the application data directory for internal data like usage statistics |
| `NANOCODER_INSTALL_METHOD` | Override installation detection (`npm`, `homebrew`, `nix`, `unknown`) |
| `NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT` | Graceful shutdown timeout in milliseconds (default: 5000) |

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
| `mode` | string | `"conservative"` | Compression mode: `"default"`, `"conservative"`, `"aggressive"` |
| `notifyUser` | boolean | `true` | Show a notification when auto-compact runs |

You can also override these per-session with `/compact --auto-on`, `/compact --auto-off`, and `/compact --threshold <n>`.

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
| `maxMessages` | number | `1000` | Maximum messages saved per session — older messages are truncated (minimum 1) |
| `retentionDays` | number | `30` | Auto-delete sessions older than this (minimum 1) |
| `directory` | string | (platform default) | Custom storage directory for session files |

### Tool Auto-Approval

Allow specific tools to run without confirmation, even in normal development mode.

```json
{
  "nanocoder": {
    "nanocoderTools": {
      "alwaysAllow": ["read_file", "find_files"]
    }
  }
}
```

The `alwaysAllow` array accepts tool names. Tools listed here will execute immediately without prompting for approval.

## Sections

- [Providers](providers/index.md) - AI provider setup and configuration
- [MCP Configuration](mcp-configuration.md) - Model Context Protocol server integration
- [Preferences](preferences.md) - User preferences and application data
- [Logging](logging.md) - Structured logging with Pino

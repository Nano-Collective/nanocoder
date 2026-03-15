---
title: "Configuration"
description: "Configure Nanocoder providers, preferences, and settings"
sidebar_order: 4
---

# Configuration

Nanocoder is configured through JSON files that control AI providers, MCP servers, user preferences, and more.

## Configuration File Locations

Nanocoder looks for configuration in the following order (first found wins):

1. **Project-level** (highest priority): `agents.config.json` in your current working directory
   - Use this for project-specific providers, models, or API keys
   - Perfect for team sharing or repository-specific configurations

2. **User-level (preferred)**: Platform-specific configuration directory
   - **macOS**: `~/Library/Preferences/nanocoder/agents.config.json`
   - **Linux/Unix**: `~/.config/nanocoder/agents.config.json`
   - **Windows**: `%APPDATA%\nanocoder\agents.config.json`
   - Your global default configuration
   - Used when no project-level config exists

   You can override this global configuration directory by setting `NANOCODER_CONFIG_DIR`. When set, Nanocoder will look for `agents.config.json` and related config files directly in this directory.

3. **User-level (legacy)**: `~/.agents.config.json`
   - Supported for backward compatibility
   - Recommended to migrate to platform-specific location above

## Environment Variables

Keep API keys out of version control using environment variables. Variables are loaded from shell environment (`.bashrc`, `.zshrc`) or `.env` file in your working directory.

- `NANOCODER_CONFIG_DIR`: Override the global configuration directory.
- `NANOCODER_CONTEXT_LIMIT`: Set a default context limit (in tokens) for models not found on models.dev. This is used as a fallback when the model's context window is unknown, enabling auto-compact and `/usage` to work correctly.
- `NANOCODER_DATA_DIR`: Override the application data directory used for internal data like usage statistics.

**Syntax:** `$VAR_NAME`, `${VAR_NAME}`, or `${VAR_NAME:-default}`
**Supported in:** `baseUrl`, `apiKey`, `models`, `disableToolModels`, `MCP server`, `command`, `args`, `env`

See `.env.example` for setup instructions.

## Sections

- [Providers](providers.md) - AI provider setup and configuration
- [MCP Configuration](mcp-configuration.md) - Model Context Protocol server integration
- [Preferences](preferences.md) - User preferences and application data
- [Logging](logging.md) - Structured logging with Pino
- [Timeouts](timeouts.md) - Timeout and connection pool configuration

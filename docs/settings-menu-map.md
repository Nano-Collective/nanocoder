---
title: "Settings Menu Map"
description: "Complete mapping of configurable parameters to TUI settings categories"
---

# Settings Menu Map

This document maps every documented configuration parameter to its location in the TUI `/settings` menu. Parameters marked ❌ are intentionally excluded from the TUI with rationale.

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Accessible via TUI `/settings` |
| ❌ | Config-file or environment variable only |

## Parameter-to-Category Mapping

| Parameter | Type | Category | Sub-Menu | Editable via TUI | Source File | Notes |
|-----------|------|----------|----------|-------------------|-------------|-------|
| `selectedTheme` | select | Appearance | Theme | ✅ | `nanocoder-preferences.json` | Live preview |
| `titleShape` | select | Appearance | Title Shape | ✅ | `nanocoder-preferences.json` | Live preview |
| `nanocoderShape` | select | Appearance | Nanocoder Shape | ✅ | `nanocoder-preferences.json` | Live preview |
| `paste.singleLineThreshold` | number | Input | Paste Threshold | ✅ | `nanocoder-preferences.json` | Enumerated choices |
| `notifications.enabled` | toggle | Behavior | Notifications | ✅ | `nanocoder-preferences.json` | |
| `notifications.sound` | toggle | Behavior | Notifications | ✅ | `nanocoder-preferences.json` | |
| `notifications.events.*` | toggle | Behavior | Notifications | ✅ | `nanocoder-preferences.json` | |
| `autoCompact.enabled` | toggle | Behavior | Auto-Compact | ✅ | `agents.config.json` | |
| `autoCompact.threshold` | number | Behavior | Auto-Compact | ✅ | `agents.config.json` | Range: 50–95 |
| `autoCompact.mode` | select | Behavior | Auto-Compact | ✅ | `agents.config.json` | default/conservative/aggressive |
| `autoCompact.notifyUser` | toggle | Behavior | Auto-Compact | ✅ | `agents.config.json` | |
| `sessions.autoSave` | toggle | Behavior | Sessions | ✅ | `agents.config.json` | |
| `sessions.saveInterval` | number | Behavior | Sessions | ✅ | `agents.config.json` | Min: 1000ms |
| `sessions.maxSessions` | number | Behavior | Sessions | ✅ | `agents.config.json` | Min: 1 |
| `sessions.maxMessages` | number | Behavior | Sessions | ✅ | `agents.config.json` | Min: 1 |
| `sessions.retentionDays` | number | Behavior | Sessions | ✅ | `agents.config.json` | Min: 1 |
| `sessions.directory` | filepath | Behavior | Sessions | ✅ | `agents.config.json` | Free-text input |
| `defaultMode` | select | Behavior | Default Mode | ✅ | `agents.config.json` | normal/auto-accept/yolo/plan |
| `reasoningExpanded` | toggle | Behavior | Reasoning Traces | ✅ | `nanocoder-preferences.json` | |
| Providers (list) | wizard | Providers | Configure Providers | ✅ | `agents.config.json` | Launches existing wizard |
| Copilot credentials | wizard | Providers | Copilot Login | ✅ | `agents.config.json` | Launches login flow |
| Codex credentials | wizard | Providers | Codex Login | ✅ | `agents.config.json` | Launches login flow |
| `alwaysAllow` (top-level) | list | Providers | Tool Auto-Approval | ✅ | `agents.config.json` | Read-only display |
| `nanocoderTools.alwaysAllow` | list | Providers | Tool Auto-Approval | ✅ | `agents.config.json` | Read-only display |
| MCP servers | wizard | MCPs | Configure MCP Servers | ✅ | `agents.config.json` | Launches existing wizard |
| `nanocoderTools.webSearch.apiKey` | text | Web Search | API Key | ✅ | `agents.config.json` | Masked input |
| `NANOCODER_*` env vars | read-only | Environment | (all) | ❌ | `process.env` | Read-only display |
| `tune.*` | wizard | Advanced | Tune Model | ✅ | `nanocoder-preferences.json` | Launches existing wizard |
| Config file paths | wizard | Advanced | Edit Config Files | ✅ | filesystem | Launches file picker |
| IDE connection | wizard | Advanced | Connect IDE | ✅ | `agents.config.json` | Launches existing wizard |

## Intentionally Excluded Parameters

| Parameter | Type | Source | Rationale |
|-----------|------|--------|-----------|
| `NANOCODER_CONFIG_DIR` | env var | environment | Set externally; affects config file lookup paths |
| `NANOCODER_DATA_DIR` | env var | environment | Set externally; affects data directory |
| `NANOCODER_CONTEXT_LIMIT` | env var | environment | Set externally; per-session override via `/context-max` |
| `NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT` | env var | environment | Developer/ops setting |
| `NANOCODER_INSTALL_METHOD` | env var | environment | Auto-detected; not user-configurable |
| `NANOCODER_PROVIDERS` | env var | environment | Override mechanism; too complex for TUI |
| `NANOCODER_PROVIDERS_FILE` | env var | environment | Override mechanism; too complex for TUI |
| `NANOCODER_MCPSERVERS` | env var | environment | Override mechanism; too complex for TUI |
| `NANOCODER_MCPSERVERS_FILE` | env var | environment | Override mechanism; too complex for TUI |
| `NANOCODER_LOG_LEVEL` | env var | environment | Logging is an operational concern |
| `NANOCODER_LOG_TO_FILE` | env var | environment | Logging is an operational concern |
| `NANOCODER_LOG_DISABLE_FILE` | env var | environment | Logging is an operational concern |
| `NANOCODER_LOG_DIR` | env var | environment | Logging is an operational concern |
| `NANOCODER_LOG_TRANSPORTS` | env var | environment | Logging is an operational concern |
| `NANOCODER_CORRELATION_ENABLED` | env var | environment | Developer/debug setting |
| `NANOCODER_CORRELATION_DEBUG` | env var | environment | Developer/debug setting |
| `contextWindow` (per provider) | number | `agents.config.json` | Too granular — per-provider setting, better edited in config file |
| `contextWindows` (per model) | object | `agents.config.json` | Too granular — per-model override map |
| `requestTimeout` (per provider) | number | `agents.config.json` | Too granular — per-provider setting |
| `socketTimeout` (per provider) | number | `agents.config.json` | Too granular — per-provider setting |
| `maxRetries` (per provider) | number | `agents.config.json` | Too granular — per-provider setting |
| `connectionPool` (per provider) | object | `agents.config.json` | Too granular — per-provider setting |
| `disableTools` (per provider) | toggle | `agents.config.json` | Too granular — per-provider setting |
| `disableToolModels` (per provider) | list | `agents.config.json` | Too granular — per-provider setting |
| `sdkProvider` (per provider) | select | `agents.config.json` | Too granular — per-provider setting |
| `headers` (per provider) | object | `agents.config.json` | Too granular — per-provider setting |
| LSP server configs | object | `agents.config.json` | Too granular — per-server config with commands, args, env |
| MCP server individual configs | object | `agents.config.json` | Handled by MCP wizard, not individual TUI settings |
| `nanocoder.notifications.timeout` | number | `nanocoder-preferences.json` | Platform-specific; not commonly adjusted |
| `nanocoder.notifications.customMessages` | object | `nanocoder-preferences.json` | Advanced customization; config-file only |

## Future Parameters (Not Yet Implemented)

| Parameter | Category | Sub-Menu | Notes |
|-----------|----------|----------|-------|
| Custom keybinds | Input | Keybinds | Planned standalone PR |
| Theme color editing | Appearance | Theme Colors | Planned standalone PR |
| Plugin management | Advanced | Plugins | Planned standalone PR |

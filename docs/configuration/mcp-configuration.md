---
title: "MCP Configuration"
description: "Configure Model Context Protocol servers to extend Nanocoder's capabilities"
sidebar_order: 3
---

# MCP Server Configuration

Configure [Model Context Protocol](https://github.com/modelcontextprotocol/servers) (MCP) servers to extend Nanocoder with external tools.

## Quick Start

Create a `.mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./src"],
      "alwaysAllow": ["list_directory", "read_file"]
    },
    "github": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "$GITHUB_TOKEN"
      }
    },
    "context7": {
      "transport": "http",
      "url": "https://mcp.context7.com/mcp",
      "timeout": 30000
    }
  }
}
```

Use `/mcp` to view connected servers and their tools. Use `/setup-mcp` for interactive setup.

## Config File Locations

| Location | File | Purpose |
|----------|------|---------|
| **Project** | `.mcp.json` in project root | Project-specific servers, shared via version control |
| **Global** | `.mcp.json` in `~/.config/nanocoder/` (Linux), `~/Library/Preferences/nanocoder/` (macOS), or `%APPDATA%\nanocoder\` (Windows) | Personal servers across all projects |

Both are loaded together. When the same server name exists in both, the project-level config takes precedence.

### Environment Variable Overrides

You can also define MCP servers via environment variables. These take **highest precedence**, overriding both project and global configs when the same server name exists.

| Variable | Description |
|----------|-------------|
| `NANOCODER_MCPSERVERS` | JSON string containing MCP server configurations |
| `NANOCODER_MCPSERVERS_FILE` | Path to a JSON file (used if `NANOCODER_MCPSERVERS` is not set) |

The JSON value accepts either a direct array or the standard `mcpServers` wrapper format:

**Direct array format:**

```bash
export NANOCODER_MCPSERVERS='[{"name":"my-server","transport":"http","url":"https://example.com/mcp"}]'
```

**Wrapper format (same as `.mcp.json`):**

```bash
export NANOCODER_MCPSERVERS='{"mcpServers":{"my-server":{"transport":"http","url":"https://example.com/mcp"}}}'
```

**File-based:**

```bash
export NANOCODER_MCPSERVERS_FILE=/path/to/mcp-servers.json
```

**Precedence order:** Environment variables > Project `.mcp.json` > Global `.mcp.json`

## Transport Types

### stdio

Spawns a local process and communicates via stdin/stdout. Used for most MCP servers.

| Field | Required | Description |
|-------|----------|-------------|
| `transport` | Yes | `"stdio"` |
| `command` | Yes | Command to execute (e.g. `npx`, `uvx`, `python`) |
| `args` | No | Array of command-line arguments |
| `env` | No | Environment variables passed to the process |

```json
{
  "custom-tools": {
    "transport": "stdio",
    "command": "python",
    "args": ["path/to/mcp_server.py"],
    "env": {
      "API_KEY": "${API_KEY:-default-key}"
    }
  }
}
```

> **Note:** For `uvx` commands, Nanocoder automatically adds `--native-tls` to use system certificates, fixing TLS issues in corporate proxy environments.

### http

Connects to remote servers using the MCP StreamableHTTP protocol.

| Field | Required | Description |
|-------|----------|-------------|
| `transport` | Yes | `"http"` |
| `url` | Yes | Server endpoint (`http://` or `https://`) |
| `headers` | No | HTTP headers (useful for authentication) |
| `timeout` | No | Connection timeout in milliseconds |

```json
{
  "github-remote": {
    "transport": "http",
    "url": "https://api.githubcopilot.com/mcp/",
    "headers": {
      "Authorization": "Bearer $GITHUB_TOKEN"
    },
    "timeout": 30000
  }
}
```

### websocket

Connects to remote servers via persistent WebSocket connections.

| Field | Required | Description |
|-------|----------|-------------|
| `transport` | Yes | `"websocket"` |
| `url` | Yes | Server endpoint (`ws://` or `wss://`) |
| `timeout` | No | Connection timeout in milliseconds |

```json
{
  "realtime-data": {
    "transport": "websocket",
    "url": "wss://api.example.com/mcp"
  }
}
```

## Common Fields

These fields work with all transport types:

| Field | Description |
|-------|-------------|
| `description` | Human-readable description shown in `/mcp` output |
| `alwaysAllow` | Array of tool names that skip confirmation prompts |
| `enabled` | Whether the server is active (default: `true`) |
| `tags` | Array of tags for categorization |

## Auto-Approve Tools

The `alwaysAllow` field specifies MCP tools that execute without confirmation in normal mode:

```json
{
  "filesystem": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "./src"],
    "alwaysAllow": ["list_directory", "read_file", "file_info"]
  }
}
```

- Tools in `alwaysAllow` skip the confirmation prompt in normal mode
- Tools not listed still require approval
- In auto-accept and yolo modes, all MCP tools run without confirmation regardless
- Only auto-approve read-only tools; avoid auto-approving tools that modify files or execute commands

## Environment Variables

Use environment variable references to keep credentials out of config files:

```json
{
  "env": {
    "TOKEN": "$TOKEN",
    "API_URL": "${API_URL}",
    "FALLBACK": "${MISSING_VAR:-default-value}"
  }
}
```

Supported syntax: `$VAR`, `${VAR}`, `${VAR:-default}`

> **Security:** Project-level `.mcp.json` files are typically version controlled. Always use environment variable references for sensitive values.

## Setup Wizard

Run `/setup-mcp` for interactive configuration with:

- Pre-configured templates for popular servers (Filesystem, GitHub, Brave Search, Context7, DeepWiki, Playwright, etc.)
- Custom server setup for stdio, HTTP, and WebSocket
- Edit or delete existing servers
- **Ctrl+E** to open the config file in your system editor

## Troubleshooting

**stdio servers:**
- _Command not found_ — Verify the command is in your PATH. Nanocoder shows install hints for common tools (`npx`, `uvx`, `python`).
- _Permission denied_ — Check execute permissions on the command/script.

**Remote servers (HTTP/WebSocket):**
- _Connection failed_ — Verify the URL is accessible. Test with `curl` for HTTP servers.
- _Authentication errors_ — For HTTP, use `headers` with a Bearer token or API key. Ensure env vars are set.

**General:**
- _Transport type mismatch_ — Ensure `transport` matches your server (`stdio` for local commands, `http`/`websocket` for remote URLs).
- _Environment variables_ — Ensure all `$VAR` references resolve. Unset variables resolve to empty strings.

For more servers and community configurations, see the [MCP servers repository](https://github.com/modelcontextprotocol/servers).

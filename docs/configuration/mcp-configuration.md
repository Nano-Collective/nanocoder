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

Use `/mcp` to view connected servers and their tools. Use `/settings mcp` for interactive setup.

## Optional: Local-First Cross-Session Memory

Nanocoder does not persist conversation context between separate runs. If you
want durable notes about a project, you can opt into a local-first memory MCP
server without changing Nanocoder itself.

The following example uses [Vestige](https://github.com/samvallad33/vestige),
but the same configuration shape works with any memory server that provides an
MCP `stdio` interface:

```json
{
  "mcpServers": {
    "memory": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "vestige-mcp-server"],
      "description": "Optional local-first cross-session memory"
    }
  }
}
```

Add the entry to your project or global `.mcp.json`, then use `/mcp` to check
that the server connected. The available tool names and memory workflow depend
on the server you choose; Nanocoder only starts the MCP process and exposes
its tools to the model.

Before enabling a memory server, review its documentation and configuration:

- Confirm where it stores data and whether it makes any network requests.
- Treat stored prompts, code, and decisions as sensitive project data.
- Do not add memory-writing tools to `alwaysAllow` unless you explicitly want
  them to run without confirmation.
- A third-party example in this section is optional and is not an official
  Nanocoder integration or endorsement.

> **Tool visibility note:** Connected MCP servers may be hidden from the model by the current `/tune` tool profile. MCP tools are available to the model only when the resolved profile is `full`; the default `auto` profile switches small local models to `minimal` or `nano`, which intentionally filters MCP tools to keep the prompt small. If `/mcp` shows a server but the model cannot call its tools, run `/tune` and set **Tool Profile** to **full** (or switch to a larger/cloud model so `auto` resolves to `full`).

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

## Phone pairing (Build Remote Agent)

Nanocoder can attach **Build Remote Agent** as a pairing device: the
iOS/Android app spectates (and can inject into) this desktop session through
the free MIT `gbr-agent`. Phone and PC never open ports to each other.

Website: https://grokbuildremote.com/ · Agent:
https://github.com/LinespottingOrg/GrokBuildRemote-Agents (MIT) · Protocol
`gbr/1` (agent **v0.6.0+**). Independent product. Not affiliated with xAI or
SpaceX.

This is not ACP and not the VS Code companion. Pairing stays `gbr-agent pair`
+ `gbr-agent run`. Attach is only `http://127.0.0.1:8788` or `gbr-mcp` stdio.
Phone is spectator + veto.

```bash
curl -fsSL https://grokbuildremote.com/install.sh | bash
gbr-agent version          # must print v0.6.0 or newer
gbr-agent pair && gbr-agent run
git clone https://github.com/LinespottingOrg/GrokBuildRemote-Agents.git
cd GrokBuildRemote-Agents/mcp/gbr-mcp && npm install
```

Add to project or global `.mcp.json` (see also `.mcp.example.json`):

```json
{
  "mcpServers": {
    "gbr": {
      "transport": "stdio",
      "command": "node",
      "args": [
        "GrokBuildRemote-Agents/mcp/gbr-mcp/bin/gbr-mcp.js"
      ],
      "description": "Build Remote Agent Bot API (loopback). Requires gbr-agent run. Never put mailbox keys here."
    }
  }
}
```

Point `args` at the absolute path to `bin/gbr-mcp.js`. Then `/mcp` to confirm
the server. Do not commit mailbox keys.

```bash
curl -sS http://127.0.0.1:8788/health
curl -sS http://127.0.0.1:8788/v1/sessions
```

## Setup Wizard

Run `/settings mcp` for interactive configuration with:

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

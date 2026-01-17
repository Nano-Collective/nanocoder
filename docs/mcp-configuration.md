# MCP Server Configuration Guide

This guide covers how to configure Model Context Protocol (MCP) servers with Nanocoder, including both local and remote server setups.

## Transport Types

Nanocoder supports three transport types for MCP servers:

### stdio (Standard Input/Output)

- **Use case**: Local command-line servers
- **Communication**: Process-based with stdin/stdout
- **Common for**: Filesystem, GitHub, local tools

### http (HTTP/HTTPS)

- **Use case**: Remote HTTP API endpoints
- **Communication**: RESTful HTTP requests
- **Common for**: Cloud services, search APIs, documentation lookup

### websocket (WebSocket)

- **Use case**: Real-time bidirectional communication
- **Communication**: Persistent WebSocket connections
- **Common for**: Live data streams, interactive services

## Configuration File Locations

Nanocoder uses a simplified 2-location approach for MCP server configuration:

### Project-Level Configuration

**File:** `.mcp.json` in your project root

- Use for project-specific MCP servers
- Shared with team via version control
- Takes precedence when same server name exists in both locations

### Global Configuration

**File:** `.mcp.json` in `~/.config/nanocoder/`

- Use for personal MCP servers across all projects
- Not version controlled
- Fallback for servers not defined at project level

> **Note:** Both configurations are loaded together. Servers from both locations are merged, with project-level servers displayed first in the UI.

## Configuration Format

### Primary Format: Claude Code Object Format (Recommended)

```json
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./src"],
      "description": "Project filesystem access",
      "alwaysAllow": ["list_directory", "read_file"],
      "env": {
        "ALLOWED_PATHS": "./src"
      }
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
      "url": "https://mcp.context7.ai/api",
      "timeout": 45000
    }
  }
}
```

### Array Format (Deprecated)

**Status:** Supported but deprecated - will show warning on startup

```json
{
  "mcpServers": [
    {
      "name": "filesystem",
      "transport": "stdio",
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "./src"]
    }
  ]
}
```

**Migration:** Convert to object format where the server name becomes the key:

```json
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "./src"]
    }
  }
}
```

## Migration from agents.config.json

If you have MCP servers in `agents.config.json`, migrate them to `.mcp.json`:

**Old format (agents.config.json):**
```json
{
  "nanocoder": {
    "mcpServers": [
      {
        "name": "filesystem",
        "command": "npx",
        "args": ["@modelcontextprotocol/server-filesystem", "."]
      }
    ]
  }
}
```

**New format (~/.config/nanocoder/.mcp.json):**
```json
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

> **Warning:** MCP servers in `agents.config.json` will trigger a deprecation warning. Please migrate to `.mcp.json` as shown above.

## Configuration Examples

### Local stdio Servers

#### File System Access

```json
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"],
      "env": {},
      "alwaysAllow": ["list_directory", "file_info"]
    }
  }
}
```

#### GitHub Integration

```json
{
  "mcpServers": {
    "github": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "$GITHUB_TOKEN"
      }
    }
  }
}
```

#### Custom Python Server

```json
{
  "mcpServers": {
    "custom-tools": {
      "transport": "stdio",
      "command": "python",
      "args": ["path/to/mcp_server.py", "--port", "8080"],
      "env": {
        "API_KEY": "${API_KEY:-default-key}",
        "DEBUG": "true"
      }
    }
  }
}
```

### Remote HTTP Servers

#### Search Service

```json
{
  "mcpServers": {
    "brave-search": {
      "transport": "http",
      "url": "https://api.brave.com/mcp/search",
      "timeout": 30000
    }
  }
}
```

#### Documentation Lookup

```json
{
  "mcpServers": {
    "context7": {
      "transport": "http",
      "url": "https://mcp.context7.ai/api",
      "timeout": 45000
    }
  }
}
```

### Remote WebSocket Servers

#### Real-time Data Stream

```json
{
  "mcpServers": {
    "market-data": {
      "transport": "websocket",
      "url": "wss://api.example.com/realtime/mcp",
      "timeout": 60000
    }
  }
}
```

## Configuration Reference

### Base Fields (All Servers)

- `name` (required, implicit as object key): Display name for the server
- `transport` (required): Transport type (`stdio`, `http`, `websocket`)
- `description` (optional): Human-readable description of the server
- `enabled` (optional): Whether the server is enabled (default: `true`)
- `tags` (optional): Array of tags for categorization
- `alwaysAllow` (optional): Array of MCP tool names that can run without user confirmation

### stdio Transport Fields

- `command` (required): Command to execute
- `args` (optional): Array of command-line arguments
- `env` (optional): Environment variables object

### http/websocket Transport Fields

- `url` (required): Server endpoint URL
- `timeout` (optional): Connection timeout in milliseconds (default: 30000)
- `headers` (optional): HTTP headers to include in requests
- `auth` (optional): Authentication configuration

### Authentication Fields

```json
{
  "auth": {
    "type": "bearer" | "basic" | "api-key" | "custom",
    "token": "$AUTH_TOKEN",           // For bearer/custom
    "username": "$USERNAME",           // For basic
    "password": "$PASSWORD",           // For basic
    "apiKey": "$API_KEY"               // For api-key
  }
}
```

### Reconnect Configuration

```json
{
  "reconnect": {
    "enabled": true,
    "maxAttempts": 3,
    "backoffMs": 1000
  }
}
```

### Auto-Approve Tools (alwaysAllow)

The `alwaysAllow` field lets you specify MCP tools that can execute without requiring user confirmation. This is useful for read-only or low-risk tools that you trust to run automatically.

```json
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./src"],
      "alwaysAllow": ["list_directory", "read_file", "file_info"]
    }
  }
}
```

**How it works:**
- Tools listed in `alwaysAllow` skip the confirmation prompt in normal mode
- Tools not in the list still require user approval before execution
- In auto-accept mode, all tools run without confirmation regardless of this setting
- The `/mcp` command shows which tools are auto-approved for each server

**Best practices:**
- Only auto-approve read-only tools (e.g., `list_directory`, `read_file`, `search`)
- Avoid auto-approving tools that modify files or execute commands
- Review the tool list for each MCP server before adding to `alwaysAllow`

**Example - Safe tools to auto-approve:**
```json
{
  "alwaysAllow": [
    "list_directory",    // Read-only directory listing
    "read_file",         // Read-only file access
    "file_info",         // File metadata only
    "search",            // Search operations
    "get_status"         // Status queries
  ]
}
```

## Environment Variables

Use environment variables to keep sensitive data out of configuration files:

```json
{
  "mcpServers": {
    "github": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}",
        "GITHUB_API_URL": "${GITHUB_API_URL:-https://api.github.com}"
      }
    }
  }
}
```

**Supported syntax:**

- `$VAR_NAME`
- `${VAR_NAME}`
- `${VAR_NAME:-default_value}`

## Popular MCP Servers

### Local Servers (stdio)

- **@modelcontextprotocol/server-filesystem**: File operations
- **@modelcontextprotocol/server-github**: GitHub repository management
- **@modelcontextprotocol/server-postgres**: Database operations
- **@modelcontextprotocol/server-brave-search**: Web search (can also be run remotely)

### Remote Services (http/websocket)

- **Context7**: API documentation lookup
- **DeepWiki**: Wikipedia and knowledge base search
- **Sequential Thinking**: Advanced reasoning capabilities
- **Remote Fetch**: Web content extraction

## MCP Configuration Wizard

For interactive MCP server setup, use the built-in configuration wizard:

```
/setup-mcp
```

The wizard provides:
- **Location selection**: Choose between project-level (`.mcp.json` in current directory) or global configuration (`~/.config/nanocoder/.mcp.json`)
- **Server templates**: Pre-configured templates for popular MCP servers (filesystem, GitHub, Brave Search, etc.)
- **Custom server setup**: Add custom stdio, HTTP, or WebSocket servers manually
- **Edit existing servers**: Modify or delete previously configured servers
- **Delete configuration**: Option to remove the configuration file entirely

### Wizard Flow

1. **Choose location**: Select where to save your MCP configuration
2. **Add servers**: Use templates or configure custom servers
   - **Local Servers (STDIO)**: Filesystem, GitHub, PostgreSQL, custom commands
   - **Remote Servers (HTTP/WebSocket)**: Context7, Brave Search, custom endpoints
3. **Configure fields**: Enter required information (paths, API keys, URLs)
4. **Review and save**: Confirm your configuration before saving

### Keyboard Shortcuts

- **Enter**: Select option / Continue
- **Shift+Tab**: Go back to previous step
- **Esc**: Exit wizard without saving
- **Tab**: Switch between tabs (when viewing server categories)
- **Ctrl+E**: Open configuration file in your system editor for manual editing


## Troubleshooting

### Connection Issues

1. **Check transport type mismatch** - Ensure `transport` field matches your server type
2. **Verify URLs** - HTTP/WebSocket URLs must be accessible from your network
3. **Timeouts** - Increase `timeout` values for slow remote services
4. **Environment variables** - Ensure all required environment variables are set

### stdio Server Issues

1. **Command not found** - Verify the command exists in your PATH
2. **Permission denied** - Check execute permissions on the command/script
3. **Missing dependencies** - Ensure required packages are installed

### Remote Server Issues

1. **Network connectivity** - Test URL accessibility with curl or browser
2. **Firewall/proxy** - Check if network policies block connections
3. **Authentication** - Verify API keys and tokens are valid

## Security Considerations

- **API Keys**: Store sensitive values in environment variables, not config files
- **Network Access**: Remote HTTP/WebSocket servers make network requests from your machine
- **Command Execution**: stdio servers execute commands on your local system
- **File Access**: Filesystem servers access files based on their configuration

> **Security Warning:** Project-level `.mcp.json` files are typically version controlled. Avoid committing hardcoded credentials. Use environment variable references instead.

## Best Practices

1. **Use specific paths** for filesystem access instead of home directory access
2. **Set appropriate timeouts** for remote services based on expected response times
3. **Monitor network usage** when connecting to remote MCP services
4. **Regular updates** - Keep MCP servers updated for security and features
5. **Test connections** - Verify MCP server connectivity before adding to production configs
6. **Environment variables** - Use `$VAR` syntax for all sensitive configuration values

## Advanced Configuration

### Multiple Instances of Same Server

```json
{
  "mcpServers": {
    "filesystem-work": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/work/projects"]
    },
    "filesystem-home": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/documents"]
    }
  }
}
```

### Hybrid Project/Global Setup

**Project (.mcp.json):**
```json
{
  "mcpServers": {
    "project-fs": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./project"]
    }
  }
}
```

**Global (~/.config/nanocoder/.mcp.json):**
```json
{
  "mcpServers": {
    "github": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "$GITHUB_TOKEN"
      }
    }
  }
}
```

Result: Both servers are available, with `project-fs` shown first (project-level), followed by `github` (global).

For more examples and community-maintained configurations, see the [MCP servers repository](https://github.com/modelcontextprotocol/servers).

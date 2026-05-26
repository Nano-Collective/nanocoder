# Nanocoder Features Overview

> A comprehensive reference of all features and capabilities in Nanocoder, generated from source code analysis.

---

## Table of Contents

- [Core Architecture](#core-architecture)
- [AI Provider Support](#ai-provider-support)
- [Tool System](#tool-system)
- [Development Modes](#development-modes)
- [Session & Conversation Management](#session--conversation-management)
- [Skills & Extensibility](#skills--extensibility)
- [Commands Reference](#commands-reference)
- [Input & Interaction](#input--interaction)
- [Non-Interactive / CI Mode](#non-interactive--ci-mode)
- [VS Code Integration](#vs-code-integration)
- [MCP Server Support](#mcp-server-support)
- [Daemon & Scheduled Runs](#daemon--scheduled-runs)
- [Model Tuning](#model-tuning)
- [Context Compression](#context-compression)
- [Checkpointing](#checkpointing)
- [Task Management](#task-management)
- [File Explorer](#file-explorer)
- [LSP Integration](#lsp-integration)
- [Notifications](#notifications)
- [Project Initialization](#project-initialization)
- [Authentication & Providers](#authentication--providers)
- [Configuration System](#configuration-system)
- [CLI Interface](#cli-interface)

---

## Core Architecture

Nanocoder is a **React-based CLI coding agent** built with [Ink.js](https://github.com/vadimdemedes/ink) that renders React components in the terminal. The architecture follows these principles:

| Component | Path | Role |
|-----------|------|------|
| **Entry point** | `source/cli.tsx` | CLI arg parsing, fast-path for `--version`/`--help`/`daemon`, boots the Ink app |
| **App root** | `source/app/App.tsx` | Orchestrates all hooks, renders the TUI |
| **State** | `source/hooks/useAppState.tsx` | Single source of truth for all app state |
| **Chat handler** | `source/hooks/chat-handler/` | Manages LLM conversation loop, streaming, tool calls |
| **Tool handler** | `source/hooks/useToolHandler.tsx` | Processes tool execution and approvals |
| **Mode handlers** | `source/hooks/useModeHandlers.tsx` | Development mode switching logic |
| **Client factory** | `source/client-factory.ts` | Creates LLM clients from provider config |
| **AI SDK client** | `source/ai-sdk-client/` | Vercel AI SDK wrapper supporting multiple providers |
| **Message queue** | `source/utils/message-queue.ts` | Global queue allowing deep components to add messages |

### Tool-Calling Paths

Nanocoder supports **three tool-calling strategies**, auto-detected per model:

1. **Native function calling** — for models that support OpenAI-style tool calling APIs
2. **XML fallback** — tools described in the system prompt; model emits XML tool calls
3. **JSON fallback** — similar to XML but uses JSON formatting

Both fallback paths include **malformed-output repair** so small/local models that produce broken XML or JSON still work.

---

## AI Provider Support

Nanocoder supports **20+ providers** through a unified configuration system. All providers are configured in `agents.config.json`.

### Local Providers (7 first-class integrations)

| Provider | Config Key | Notes |
|----------|-----------|-------|
| **Ollama** | `type: "ollama"` or OpenAI-compatible | Most popular local runner |
| **llama.cpp** | OpenAI-compatible | High-performance inference server |
| **LM Studio** | OpenAI-compatible | Desktop app for local models |
| **MLX Server** | OpenAI-compatible | Apple Silicon optimized |
| **vLLM** | OpenAI-compatible | High-throughput serving engine |
| **LocalAI** | OpenAI-compatible | OpenAI-compatible local API |
| **llama-swap** | OpenAI-compatible | Model multiplexer for llama.cpp |

### Cloud Providers (OpenAI-Compatible)

| Provider | SDK Provider | Notes |
|----------|-------------|-------|
| **OpenRouter** | `openai-compatible` | Unified API for 100+ models, special request body support |
| **OpenAI** | `openai-compatible` | GPT models |
| **Mistral AI** | `openai-compatible` | Mistral and Codestral |
| **GitHub Models** | `openai-compatible` | AI models via GitHub marketplace |
| **Poe** | `openai-compatible` | Multi-model access |
| **Z.ai** | `openai-compatible` | GLM models from Zhipu AI |
| **Z.ai Coding** | `openai-compatible` | Z.ai coding subscription |

### Native SDK Providers

| Provider | `sdkProvider` | Auth Method |
|----------|---------------|-------------|
| **Anthropic Claude** | `anthropic` | API key |
| **Google Gemini** | `google` | API key |
| **GitHub Copilot** | `github-copilot` | Device OAuth flow |
| **ChatGPT / Codex** | `chatgpt-codex` | Browser login (OAuth) |
| **Kimi Code** | `anthropic` (compatible) | API key |
| **MiniMax Coding** | `anthropic` (compatible) | API key |

### Provider Factory

`source/ai-sdk-client/providers/provider-factory.ts` lazily loads provider SDK packages — only the active provider's SDK is imported at runtime, keeping boot fast.

---

## Tool System

Nanocoder ships a comprehensive set of **built-in tools** organized into categories. All tools are registered through the `ToolRegistry` (`source/tools/tool-registry.ts`) and filtered by the active tool profile and development mode.

### Static Tools (Always Available)

| Tool | File | Description |
|------|------|-------------|
| `read_file` | `source/tools/read-file.tsx` | Read file contents with optional line range |
| `write_file` | `source/tools/file-ops/write-file.tsx` | Write or create files |
| `string_replace` | `source/tools/file-ops/string-replace.tsx` | Precise text replacement in files |
| `execute_bash` | `source/tools/execute-bash.tsx` | Run shell commands |
| `web_search` | `source/tools/web-search.tsx` | Brave Search API integration |
| `fetch_url` | `source/tools/fetch-url.tsx` | Fetch web page content |
| `find_files` | `source/tools/find-files.tsx` | Find files by name/glob pattern |
| `search_file_contents` | `source/tools/search-file-contents.tsx` | Grep-style content search |
| `list_directory` | `source/tools/list-directory.tsx` | List directory contents |
| `agent` | `source/tools/agent-tool.tsx` | Delegate to subagents |
| `ask_user` | `source/tools/ask-question.tsx` | Ask user a clarifying question |
| `lsp_get_diagnostics` | `source/tools/lsp-get-diagnostics.tsx` | Get LSP diagnostics |

### File Operation Tools

| Tool | Description |
|------|-------------|
| `copy_file` | Copy a file to a new location |
| `move_file` | Move/rename a file |
| `create_directory` | Create directories |
| `delete_file` | Delete files |

### Git Tools (Conditional — requires `git` installed)

| Tool | File | Description |
|------|------|-------------|
| `git_status` | `git-status.tsx` | Show working tree status |
| `git_diff` | `git-diff.tsx` | Show diffs |
| `git_log` | `git-log.tsx` | Show commit history |
| `git_add` | `git-add.tsx` | Stage files |
| `git_commit` | `git-commit.tsx` | Create commits |
| `git_push` | `git-push.tsx` | Push to remote |
| `git_pull` | `git-pull.tsx` | Pull from remote |
| `git_branch` | `git-branch.tsx` | Branch operations |
| `git_stash` | `git-stash.tsx` | Stash operations |
| `git_reset` | `git-reset.tsx` | Reset operations |
| `git_pr` | `git-pr.tsx` | Create PRs via `gh` CLI (requires `gh`) |

### Task Management Tools

| Tool | Description |
|------|-------------|
| `create_task` | Create a new task |
| `list_tasks` | List all tasks |
| `update_task` | Update task status |
| `delete_task` | Remove a task |

### Tool Approval System

Tools go through an approval pipeline controlled by:
1. **Development mode** (normal → confirm, auto-accept → most auto, yolo → all auto)
2. **`alwaysAllow`** config — tools listed here skip confirmation
3. **`disabledTools`** config — tools listed here are completely removed
4. **Tool profile** (tune) — `full`, `minimal`, or `nano` profiles

---

## Development Modes

Four modes control how tool calls are executed. Toggle with **Shift+Tab** or boot with `--mode`.

| Mode | Behavior | Status Bar Color |
|------|----------|-----------------|
| **Normal** (default) | Every tool requires confirmation | Default |
| **Auto-Accept** | Most tools auto-run; bash and destructive git still prompt | Yellow indicator |
| **Yolo** | All tools auto-execute, no exceptions | Red indicator |
| **Plan** | Read-only exploration; mutation tools removed; produces structured plan | Blue indicator |

### Plan Mode Tool Set

Plan mode allows only:
- `read_file`, `find_files`, `search_file_contents`, `list_directory`
- `git_status`, `git_diff`, `git_log` (read-only git)
- `lsp_get_diagnostics`
- `web_search`, `fetch_url`
- `ask_user`, `agent`

All file mutation tools, `execute_bash`, task tools, and git write tools are excluded.

---

## Session & Conversation Management

### Auto-Save

Sessions are automatically saved every 30 seconds (configurable). They include:
- Full conversation history
- Provider and model used
- Working directory
- Timestamps and message count

### Session Commands

| Command | Description |
|---------|-------------|
| `/resume` | Browse and resume previous sessions |
| `/resume last` | Jump to most recent session |
| `/resume {id}` | Resume by session ID |
| `/rename <name>` | Rename current session (max 100 chars) |
| `/sessions`, `/history` | Aliases for `/resume` |
| `/export` | Export session to markdown |

### Session Storage

| Platform | Default Path |
|----------|-------------|
| macOS | `~/Library/Application Support/nanocoder/sessions/` |
| Linux | `~/.local/share/nanocoder/sessions/` |
| Windows | `%APPDATA%/nanocoder/sessions/` |

### Configuration

```json
{
  "nanocoder": {
    "sessions": {
      "autoSave": true,
      "saveInterval": 30000,
      "maxSessions": 100,
      "maxMessages": 1000,
      "retentionDays": 30
    }
  }
}
```

---

## Skills & Extensibility

**Skills** are the unified extension model. A skill can contain commands, subagents, tools, and event subscriptions.

### Single-File Form

Drop a `.md` file in `.nanocoder/commands/`, `.nanocoder/agents/`, or `.nanocoder/tools/`.

### Bundle Form

A directory under `.nanocoder/skills/<name>/` with `skill.yaml`:

```
.nanocoder/skills/k8s/
  skill.yaml
  commands/k8s.md
  agents/k8s-agent.md
  tools/
    k8s_pods.md
    k8s_logs.md
```

### Skill Primitives

| Primitive | Directory | Description |
|-----------|-----------|-------------|
| **Custom Commands** | `.nanocoder/commands/` | Reusable prompts invoked as `/command` |
| **Subagents** | `.nanocoder/agents/` | Specialized AI agents with isolated context |
| **Custom Tools** | `.nanocoder/tools/` | Model-callable shell scripts with input schemas |
| **Event Subscriptions** | In frontmatter/manifest | `file.changed` and `schedule.cron` triggers |

### Skill Commands

| Command | Description |
|---------|-------------|
| `/skills` | List all loaded skills |
| `/skills show <name>` | Inspect a skill's members and subscriptions |
| `/skills create <name>` | Scaffold a new bundle skill |
| `/commands create <name>` | Create a single-file command |
| `/agents create <name>` | Create a single-file subagent |
| `/tools create <name>` | Create a single-file custom tool |

---

## Commands Reference

### Built-in Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/init` | Generate `AGENTS.md` from project analysis |
| `/setup-providers` | Interactive provider configuration wizard |
| `/setup-mcp` | Interactive MCP server setup wizard |
| `/setup-config` | Open config file in `$EDITOR` |
| `/clear` | Clear chat history |
| `/model` | Switch models |
| `/provider` | Switch providers |
| `/status` | Current provider, model, context usage |
| `/tasks` | Manage task list |
| `/model-database` | Browse coding models from OpenRouter |
| `/settings` | Theme, title shape, paste threshold, notifications |
| `/mcp` | Show connected MCP servers and tools |
| `/custom-commands` | List all custom commands |
| `/checkpoint` | Save/restore conversation snapshots |
| `/compact` | Compress message history |
| `/context-max` | Set max context length |
| `/exit` | Exit the application |
| `/export` | Export session to markdown |
| `/update` | Update to latest version |
| `/usage` | Visual context usage display |
| `/lsp` | List connected LSP servers |
| `/schedule` | View cron subscriptions (read-only) |
| `/skills` | List/inspect/create skills |
| `/resume` | Resume previous sessions |
| `/rename` | Rename current session |
| `/explorer` | Interactive file browser |
| `/tune` | Runtime model tuning |
| `/ide` | Connect to IDE |
| `/agents` | List/create/copy subagents |
| `/commands` | List/create custom commands |
| `/tools` | List all registered tools |
| `/copilot login` | GitHub Copilot device OAuth |
| `/codex login` | ChatGPT/Codex browser login |

---

## Input & Interaction

### Special Syntax

| Syntax | Description |
|--------|-------------|
| `@file` | Include file contents via fuzzy search (Tab to select) |
| `@file:10-20` | Include specific line range |
| `@file:10` | Include single line |
| `!command` | Run shell command, output becomes AI context |

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Submit prompt | Enter |
| New line | Ctrl+J |
| Toggle dev mode | Shift+Tab |
| Cancel response | Esc |
| Clear input | Esc (twice) |
| Toggle compact tool output | Ctrl+O |
| Toggle reasoning traces | Ctrl+R |
| Prompt history | Up/Down |
| Accept autocomplete | Tab |

---

## Non-Interactive / CI Mode

For scripting, automation, and CI pipelines:

```bash
nanocoder run "Add error handling to src/api.ts"
```

### Behavior

- Submits the prompt, auto-accepts tool calls, exits when complete
- Renders through a minimal shell: plain markdown output, chronological tool one-liners, single status line
- Default mode is `auto-accept` (overridable with `--mode`)
- If a tool requires approval that the active mode won't grant, exits with status code 1

### Examples

```bash
nanocoder run "Fix the failing tests"
nanocoder --mode plan run "audit auth module"
nanocoder --mode yolo run "update README and push"
```

---

## VS Code Integration

The companion VS Code extension (`plugins/vscode/`) provides:

- **Live diff previews** — see proposed changes in VS Code's diff viewer before approving
- **Active editor context** — the focused file (and any selection) is auto-attached to messages
- **LSP diagnostics sharing** — VS Code diagnostics shared with Nanocoder
- **Command palette integration** — start/stop Nanocoder from VS Code

### Usage

```bash
nanocoder --vscode          # Start with VS Code integration
/ide                         # Connect from within a session
```

### Extension Features

| Feature | Description |
|---------|-------------|
| `⊡ In <file>` pill | Shows active editor context in status line |
| `⊡ <file> (L10-25)` | Shows when lines are selected |
| WebSocket server | Port 51820 (configurable) for CLI↔editor communication |
| Auto-install | First `--vscode` run prompts to install the extension |

---

## MCP Server Support

Connect [Model Context Protocol](https://modelcontextprotocol.io/) servers to extend Nanocoder's tools.

### Transport Types

| Transport | Use Case |
|-----------|----------|
| `stdio` | Local process communication (most common) |
| `http` | Remote MCP servers (StreamableHTTP protocol) |
| `websocket` | Persistent WebSocket connections |

### Configuration

- **Project-level**: `.mcp.json` in project root
- **Global**: `.mcp.json` in platform config directory
- **Environment**: `NANOCODER_MCPSERVERS` or `NANOCODER_MCPSERVERS_FILE`

### Features

- `alwaysAllow` per-server tool auto-approval
- Environment variable substitution for credentials
- Interactive setup wizard (`/setup-mcp`)
- Templates for popular servers (Filesystem, GitHub, Brave Search, Context7, DeepWiki, Playwright)

---

## Daemon & Scheduled Runs

The per-project daemon (`source/daemon/`) enables event-driven skill execution.

### Daemon Commands

```bash
nanocoder daemon start      # Start daemon (detached)
nanocoder daemon stop       # Graceful shutdown via IPC
nanocoder daemon status     # Check if running
nanocoder daemon logs       # Tail daemon log (last 64KB)
nanocoder daemon install    # Install auto-start (macOS/Linux/Windows)
nanocoder daemon uninstall  # Remove auto-start
```

### Auto-Start Support

| Platform | Method |
|----------|--------|
| macOS | LaunchAgent (`~/Library/LaunchAgents/`) |
| Linux | systemd user unit (`~/.config/systemd/user/`) |
| Windows | Task Scheduler (ONLOGON trigger via `schtasks`) |

### Event Subscriptions

```yaml
subscribe:
  - kind: file.changed
    target: agent:docs-agent
    paths: ["docs/**"]
    eventKinds: [add, change]

  - kind: schedule.cron
    target: command:weekly-report
    cron: "0 9 * * MON"
    confirm: true   # optional: run in plan mode instead of headless
```

### IPC

- **macOS/Linux**: `AF_UNIX` socket at `.nanocoder/daemon.sock`
- **Windows**: Named pipe at `\\.\pipe\nanocoder-daemon-<hash>`

---

## Model Tuning

`/tune` opens a modal UI for runtime model behavior adjustment. Settings persist in `nanocoder-preferences.json`.

### Tool Profiles

| Profile | Tools | System Prompt | Target |
|---------|-------|---------------|--------|
| **full** (default) | All tools | Full | Modern cloud models |
| **minimal** | 8 core tools | Slim | Small models (1B-8B) |
| **nano** | 5 core tools | Ultra-slim (~150-250 tokens) | Smallest models / low-end hardware |

### Tunable Parameters

| Parameter | Range |
|-----------|-------|
| Temperature | 0.1 - 2.0 |
| Top P | 0 - 1.0 |
| Top K | 1 - 200 |
| Max Tokens | 64 - 32768 |
| Frequency Penalty | -2.0 - 2.0 |
| Presence Penalty | -2.0 - 2.0 |

### Additional Tune Settings

- **Include AGENTS.md** — toggle project context in system prompt
- **Aggressive Compact** — 40% threshold, aggressive mode
- **Native Tool Calling** — toggle on/off (use XML/JSON fallback)

### Presets

| Preset | Settings |
|--------|----------|
| Default | All defaults (tune disabled) |
| Small Model | Minimal profile, aggressive compact, temp 0.7 |
| Nano (low-end) | Nano profile, aggressive compact, AGENTS.md off, temp 0.4, max 2048 tokens |

### Configuration Layers (highest priority wins)

1. Hardcoded defaults
2. `tune` in `agents.config.json`
3. Per-provider `tune` config
4. Preferences (saved via `/tune` UI)
5. Session override (runtime)

---

## Context Compression

Manage token usage in long conversations with two strategies:

### Strategies

| Strategy | Method | Fidelity | Cost |
|----------|--------|----------|------|
| **LLM** (default) | Model writes structured markdown summary | High | One extra API call |
| **Mechanical** | Regex-based per-message truncation | Lower | Zero cost |

### Commands

```bash
/compact                        # Compress with current strategy
/compact --preview              # Preview without applying
/compact --restore              # Restore from backup
/compact --mechanical           # Force mechanical
/compact --llm                  # Force LLM
/compact --aggressive           # Maximum compression
/compact --conservative         # Preserve more detail
/compact --auto-on              # Enable auto-compact for session
/compact --auto-off             # Disable auto-compact for session
/compact --threshold 75         # Set trigger threshold
/compact --strategy mechanical  # Persist strategy for session
```

### Auto-Compact Configuration

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

---

## Checkpointing

Save and restore session snapshots for safe experimentation.

### Commands

| Command | Description |
|---------|-------------|
| `/checkpoint create [name]` | Save checkpoint (auto-names with timestamp) |
| `/checkpoint list` | List all checkpoints |
| `/checkpoint load [name]` | Restore from checkpoint |
| `/checkpoint delete <name>` | Delete a checkpoint |

### What Gets Saved

- Complete conversation history
- Modified files (detected via git)
- Active provider and model configuration
- Timestamp and metadata

### Storage

`.nanocoder/checkpoints/` in project directory.

---

## Task Management

Track multi-step work with built-in task tools.

### Commands

```bash
/tasks                        # View all tasks
/tasks add Implement auth     # Add a new task
/tasks Implement auth         # Shorthand for add
/tasks remove 1               # Remove by number
/tasks rm 1                   # Alias for remove
/tasks clear                  # Clear all tasks
```

### AI-Managed Tasks

The AI has access to `create_task`, `list_tasks`, `update_task`, `delete_task` and will proactively manage tasks during complex work.

### Storage

`.nanocoder/tasks.json` — auto-cleared on startup and `/clear`.

---

## File Explorer

Interactive file browser accessible via `/explorer`.

### Features

- Tree view with expandable directories
- File preview with syntax highlighting
- Compressed indentation for narrow terminals
- Multi-select (Space to toggle)
- Directory selection (selects all files within)
- Search mode (press `/`)
- Token estimation with warnings for large selections
- Respects `.gitignore`

### Navigation

| Key | Action |
|-----|--------|
| Up/Down | Navigate |
| Enter | Expand/preview |
| Space | Select |
| `/` | Search |
| Esc | Exit and add selections as `@file` mentions |

---

## LSP Integration

Nanocoder can connect to Language Server Protocol servers for diagnostics.

### Components

| Component | File | Role |
|-----------|------|------|
| LSP Manager | `source/lsp/lsp-manager.ts` | Manages LSP server lifecycle |
| LSP Client | `source/lsp/lsp-client.ts` | Communicates with LSP servers |
| Server Discovery | `source/lsp/server-discovery.ts` | Auto-discovers LSP servers |
| Protocol | `source/lsp/protocol.ts` | LSP protocol implementation |

### Usage

```bash
/lsp                    # List connected LSP servers
```

The `lsp_get_diagnostics` tool makes diagnostics available to the AI for understanding code issues.

---

## Notifications

Desktop notifications when Nanocoder needs attention.

### Notification Events

| Event | Description |
|-------|-------------|
| Tool Confirmation | A tool needs approval |
| Question Prompt | AI asked a question |
| Generation Complete | AI finished responding |

### Platform Support

| Platform | Method | Icon |
|----------|--------|:----:|
| macOS | `terminal-notifier` (preferred) / `osascript` (fallback) | ✓/✗ |
| Linux | `notify-send` | ✓ |
| Windows | PowerShell toast | ✗ |

### Configuration

Via `/settings` → Notifications or `nanocoder-preferences.json`.

---

## Project Initialization

`/init` analyzes your project and generates an `AGENTS.md` file.

### What It Does

1. **Scans project files** (`source/init/file-scanner.ts`)
2. **Detects frameworks** (`source/init/framework-detector.ts`)
3. **Detects languages** (`source/init/language-detector.ts`)
4. **Analyzes project structure** (`source/init/project-analyzer.ts`)
5. **Generates `AGENTS.md`** (`source/init/agents-template-generator.ts`)

### Flags

- `/init` — Generate AGENTS.md (skips if exists)
- `/init --force` — Regenerate even if AGENTS.md exists
- `/init --lean` — Skip merging `CLAUDE.md` content

The generated `AGENTS.md` is auto-loaded every session as project context for the AI.

---

## Authentication & Providers

### GitHub Copilot

- Device OAuth flow via `/copilot login`
- Credentials stored securely in platform keychain/filesystem
- Auto-refreshes access tokens

### ChatGPT / Codex

- Browser-based login via `/codex login`
- OAuth token management with auto-refresh
- Backend API at `chatgpt.com/backend-api/codex`

### Credential Management

| Component | File |
|-----------|------|
| Copilot credentials | `source/config/copilot-credentials.ts` |
| Codex credentials | `source/config/codex-credentials.ts` |
| OAuth login | `source/commands/oauth-login.tsx` |
| Auth module | `source/auth/` |

---

## Configuration System

### Config File Locations

| Priority | Location | Scope |
|----------|----------|-------|
| 1 (highest) | `agents.config.json` in CWD | Project-level |
| 2 | Platform config directory | User-level |
| Override | `NANOCODER_CONFIG_DIR` env var | Custom directory |

### Platform Config Paths

| Platform | Path |
|----------|------|
| macOS | `~/Library/Preferences/nanocoder/` |
| Linux | `~/.config/nanocoder/` |
| Windows | `%APPDATA%\nanocoder\` |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `NANOCODER_CONFIG_DIR` | Override config directory |
| `NANOCODER_CONTEXT_LIMIT` | Default context limit (tokens) |
| `NANOCODER_DATA_DIR` | Override data directory |
| `NANOCODER_PROVIDERS` | JSON string of provider configs |
| `NANOCODER_PROVIDERS_FILE` | Path to providers JSON file |
| `NANOCODER_MCPSERVERS` | JSON string of MCP configs |
| `NANOCODER_MCPSERVERS_FILE` | Path to MCP JSON file |
| `NANOCODER_LOG_LEVEL` | Log level (trace/debug/info/warn/error/fatal) |
| `NANOCODER_LOG_TO_FILE` | Enable file logging |
| `NANOCODER_INSTALL_METHOD` | Override install detection |

### Config Sections

| Section | Key | Description |
|---------|-----|-------------|
| Providers | `providers[]` | AI provider configurations |
| Auto-compact | `nanocoder.autoCompact` | Context compression settings |
| Sessions | `nanocoder.sessions` | Session management settings |
| Paste | `nanocoder.paste` | Paste handling threshold |
| Default mode | `nanocoder.defaultMode` | Initial dev mode |
| Tool approval | `nanocoder.alwaysAllow` | Auto-approved tools |
| Disabled tools | `nanocoder.disabledTools` | Globally disabled tools |
| System prompt | `nanocoder.systemPrompt` | Custom system prompt |
| Web search | `nanocoder.nanocoderTools.webSearch` | Brave Search API key |
| Tune | `tune` (per-provider) | Runtime tuning defaults |

---

## CLI Interface

### Usage

```
nanocoder [options] [command]
```

### Commands

| Command | Description |
|---------|-------------|
| `run "prompt"` | Non-interactive mode |
| `copilot login` | GitHub Copilot OAuth |
| `codex login` | ChatGPT/Codex login |
| `daemon <sub>` | Manage per-project daemon |

### Options

| Flag | Description |
|------|-------------|
| `--version`, `-v` | Show version |
| `--help`, `-h` | Show help |
| `--vscode` | Enable VS Code integration |
| `--vscode-port` | VS Code WebSocket port |
| `--provider` | Specify provider |
| `--model` | Specify model |
| `--context-max` | Set max context (supports `k` suffix) |
| `--mode` | Start in specific mode (normal/auto-accept/yolo/plan) |

### Distribution

| Method | Command |
|--------|---------|
| npm | `npm install -g @nanocollective/nanocoder` |
| Homebrew | `brew tap nano-collective/nanocoder && brew install nanocoder` |
| Nix Flakes | `nix run github:Nano-Collective/nanocoder` |

---

## Data Flow

```
User Input
    │
    ▼
┌──────────────┐    ┌─────────────────┐    ┌───────────────┐
│  Chat Input  │───▶│  Chat Handler   │───▶│  AI SDK Client│
│  Component   │    │  (useChatHandler│    │  (AISDKClient)│
└──────────────┘    └─────────────────┘    └───────┬───────┘
                                                    │
                                                    ▼
                                            ┌───────────────┐
                                            │  LLM Provider  │
                                            │  (API call)    │
                                            └───────┬───────┘
                                                    │
                                                    ▼
                                            ┌───────────────┐
                                            │  Tool Handler  │
                                            │  (approval +   │
                                            │   execution)   │
                                            └───────┬───────┘
                                                    │
                                          ┌─────────┼─────────┐
                                          ▼         ▼         ▼
                                    ┌──────────┐ ┌──────┐ ┌──────────┐
                                    │ Built-in │ │ MCP  │ │ Custom   │
                                    │  Tools   │ │Tools │ │  Tools   │
                                    └──────────┘ └──────┘ └──────────┘
```

---

*This document was generated from source code analysis of the Nanocoder repository.*

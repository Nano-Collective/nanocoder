---
title: "Commands"
description: "Complete reference of built-in slash commands and special input syntax"
sidebar_order: 5
---

# Commands Reference

Type `/` in the chat input to see available commands. All commands start with `/` and can be invoked at any point during a session.

## Built-in Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/init` | Initialize project with intelligent analysis, create AGENTS.md and configuration files. Use `/init --force` to regenerate AGENTS.md if it already exists |
| `/setup-providers` | Interactive wizard for configuring AI providers with templates |
| `/setup-mcp` | Interactive wizard for configuring MCP servers with templates |
| `/setup-config` | Open a configuration file in your `$EDITOR` (lists project and global config files) |
| `/clear` | Clear chat history |
| `/model` | Switch between available models |
| `/provider` | Switch between configured AI providers |
| `/status` | Display current status (CWD, provider, model, theme, available updates, AGENTS setup) |
| `/tasks` | Manage task list for tracking complex work (see [Task Management](task-management.md)) |
| `/model-database` | Browse coding models from OpenRouter (searchable, filterable by open/proprietary) |
| `/settings` | Interactive menu to access Nanocoder settings (theme, title-shape, nanocoder-shape, paste-threshold) |
| `/mcp` | Show connected MCP servers and their tools |
| `/custom-commands` | List all custom commands |
| `/checkpoint` | Save and restore conversation snapshots (see [Checkpointing](checkpointing.md)) |
| `/compact` | Compress message history to reduce context usage (see [Context Compression](context-compression.md)) |
| `/context-max` | Set maximum context length for the current session (useful for models not listed on models.dev). Also available as `--context-max` CLI flag |
| `/exit` | Exit the application |
| `/export` | Export current session to markdown file |
| `/update` | Update Nanocoder to the latest version |
| `/usage` | Get current model context usage visually |
| `/lsp` | List connected LSP servers |
| `/schedule` | Schedule recurring AI tasks (see [Scheduler](scheduler.md)) |
| `/resume` | Resume a previous chat session (aliases: `/sessions`, `/history`). See [Session Management](session-management.md) |
| `/explorer` | Interactive file browser to navigate, preview, and select files for context |
| `/tune` | Configure runtime model behaviour — tool profiles, compaction, native tools, model parameters (see [Tune](tune.md)) |
| `/ide` | Connect to an IDE for live integration (e.g., VS Code diff previews) |

## Special Input Syntax

These shortcuts work directly in the chat input — no `/` prefix needed.

| Syntax | Description |
|--------|-------------|
| `!command` | Execute bash commands directly without leaving Nanocoder (output becomes context for the LLM) |
| `@file` | Include file contents in messages via fuzzy search — press Tab to select from suggestions |
| `@file:10-20` | Include specific line range from a file (line 10 to 20) |
| `@file:10` | Include a single line from a file |

### File Mentions

The `@` syntax triggers real-time fuzzy matching as you type. Nanocoder searches your project files (respecting `.gitignore`) and shows autocomplete suggestions. Press **Tab** to accept a suggestion.

You can narrow the context by specifying line ranges:

```
What does this function do? @src/utils.ts:45-80
Explain the error on @src/app.tsx:23
```

### Shell Commands

The `!` prefix runs a command in your shell and includes the output as context for the AI:

```
!git log --oneline -10
!npm test -- --filter auth
```

## Non-Interactive Mode

Run Nanocoder without an interactive session for scripting and automation:

```bash
nanocoder run "Add error handling to src/api.ts"
```

This submits the prompt in auto-accept mode and exits when complete. Useful for CI pipelines, git hooks, or chaining with other tools.

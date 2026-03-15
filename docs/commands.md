---
title: "Commands"
description: "Complete reference of built-in slash commands"
sidebar_order: 6
---

# Commands Reference

## Built-in Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/init` | Initialize project with intelligent analysis, create AGENTS.md and configuration files. Use `/init --force` to regenerate AGENTS.md if it already exists |
| `/setup-providers` | Interactive wizard for configuring AI providers with templates |
| `/setup-mcp` | Interactive wizard for configuring MCP servers with templates |
| `/clear` | Clear chat history |
| `/model` | Switch between available models |
| `/provider` | Switch between configured AI providers |
| `/status` | Display current status (CWD, provider, model, theme, available updates, AGENTS setup) |
| `/tasks` | Manage task list for tracking complex work (see [Task Management](features/task-management.md)) |
| `/model-database` | Browse coding models from OpenRouter (searchable, filterable by open/proprietary) |
| `/settings` | Interactive menu to access Nanocoder theme settings (theme, title-shape, nanocoder-shape) and commands |
| `/mcp` | Show connected MCP servers and their tools |
| `/custom-commands` | List all custom commands |
| `/checkpoint` | Save and restore conversation snapshots (see [Checkpointing](features/checkpointing.md)) |
| `/compact` | Compress message history to reduce context usage (see [Context Compression](features/context-compression.md)) |
| `/context-max` | Set maximum context length for the current session (useful for models not listed on models.dev) |
| `/exit` | Exit the application |
| `/export` | Export current session to markdown file |
| `/update` | Update Nanocoder to the latest version |
| `/usage` | Get current model context usage visually |
| `/lsp` | List connected LSP servers |
| `/schedule` | Schedule recurring AI tasks (see [Scheduler](features/scheduler.md)) |
| `/explorer` | Interactive file browser to navigate, preview, and select files for context |
| `/ide` | Connect to an IDE for live integration (e.g., VS Code diff previews) |

## Special Input Syntax

| Syntax | Description |
|--------|-------------|
| `!command` | Execute bash commands directly without leaving Nanocoder (output becomes context for the LLM) |
| `@file` | Include file contents in messages automatically via fuzzy search as you type |

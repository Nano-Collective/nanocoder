---
title: "Features"
description: "Overview of Nanocoder's key features and capabilities"
sidebar_order: 1
---

# Features

Nanocoder comes with a rich set of features designed for local-first AI-assisted development.

## Multi-Provider Support

- **Universal OpenAI compatibility**: Works with any OpenAI-compatible API
- **Local providers**: Ollama, LM Studio, vLLM, LocalAI, llama.cpp
- **Cloud providers**: OpenRouter, OpenAI, and other hosted services
- **Smart fallback**: Automatically switches to available providers if one fails
- **Per-provider preferences**: Remembers your preferred model for each provider
- **Dynamic configuration**: Add any provider with just a name and endpoint

## Advanced Tool System

- **Built-in tools**: File operations, bash command execution
- **MCP (Model Context Protocol) servers**: Extend capabilities with any MCP-compatible tool
- **Dynamic tool loading**: Tools are loaded on-demand from configured MCP servers
- **Tool approval**: Optional confirmation before executing potentially destructive operations

## Enhanced User Experience

- **Smart autocomplete**: Tab completion for commands with real-time suggestions
- **Colorized output**: Syntax highlighting and structured display
- **Session persistence**: Maintains context and preferences across sessions
- **Real-time streaming**: Live token-by-token streaming of AI responses
- **Real-time indicators**: Shows token usage, timing, and processing status
- **First-time directory security disclaimer**: Prompts on first run and stores a per-project trust decision to prevent accidental exposure of local code or secrets

## Developer Features

- **TypeScript-first**: Full type safety and IntelliSense support
- **Extensible architecture**: Plugin-style system for adding new capabilities
- **Project-specific config**: Different settings per project via `agents.config.json`
- **Error resilience**: Graceful handling of provider failures and network issues

## Feature Documentation

- [Custom Commands](custom-commands.md) - Define reusable AI prompts as markdown files
- [Context Compression](context-compression.md) - Manage token usage during extended conversations
- [Checkpointing](checkpointing.md) - Save and restore conversation snapshots
- [Task Management](task-management.md) - Track complex multi-step work
- [Scheduler](scheduler.md) - Schedule recurring AI tasks
- [Session Management](session-management.md) - Save and resume chat sessions
- [VS Code Extension](vscode-extension.md) - Live diff previews and editor integration

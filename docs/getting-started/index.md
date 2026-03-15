---
title: "Getting Started"
description: "Get up and running with Nanocoder quickly"
sidebar_order: 3
---

# Getting Started

Welcome to Nanocoder! This section covers everything you need to install, configure, and start using Nanocoder.

## Quick Start

1. **Install** Nanocoder via npm:

   ```bash
   npm install -g @nanocollective/nanocoder
   ```

2. **Run** in any project directory:

   ```bash
   nanocoder
   ```

3. **Configure** a provider when prompted, or run `/setup-providers` for the interactive wizard.

## CLI Options

Nanocoder supports standard CLI arguments for quick information and help:

```bash
# Show version information
nanocoder --version
nanocoder -v

# Show help and available options
nanocoder --help
nanocoder -h
```

**CLI Options Reference:**

| Option | Short | Description |
|--------|-------|-------------|
| `--version` | `-v` | Display the installed version number |
| `--help` | `-h` | Show usage information and available options |
| `--vscode` | | Run in VS Code mode (for extension) |
| `--vscode-port` | | Specify VS Code server port |
| `run` | | Run in non-interactive mode |

## Interactive Mode

To start Nanocoder in interactive mode (the default), simply run:

```bash
nanocoder
```

This will open an interactive chat session where you can:

- Chat with the AI about your code
- Use slash commands (e.g., `/help`, `/model`, `/status`)
- Execute bash commands with `!`
- Tag files with `@`
- Review and approve tool executions
- Switch between different models and providers

## Non-Interactive Mode

For automated tasks, scripting, or CI/CD pipelines, use the `run` command:

```bash
nanocoder run "your prompt here"
```

**Examples:**

```bash
# Simple task
nanocoder run "analyze the code in src/app.ts"

# Code generation
nanocoder run "create a new React component for user login"

# Testing
nanocoder run "write unit tests for all functions in utils.js"

# Refactoring
nanocoder run "refactor the database connection to use a connection pool"
```

**Non-interactive mode behavior:**

- Automatically executes the given prompt
- Runs in auto-accept mode (tools execute without confirmation)
- Displays all output and tool execution results
- Exits automatically when the task is complete

**Note:** When using non-interactive mode with VS Code integration, place any flags (like `--vscode` or `--vscode-port`) before the `run` command:

```bash
nanocoder --vscode run "your prompt"
```

## Next Steps

- [Installation](installation.md) - Full installation options (npm, Homebrew, Nix, development setup)
- [Uninstalling](uninstalling.md) - How to remove Nanocoder and clean up
- [Configuration](../configuration/index.md) - Set up AI providers, MCP servers, and preferences
- [Features](../features/index.md) - Custom commands, checkpointing, development modes, and more

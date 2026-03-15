---
title: "Usage"
description: "How to use Nanocoder in interactive and non-interactive modes"
sidebar_order: 3
---

# Usage

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

**Common Use Cases:**

```bash
# Check version in scripts
echo "Nanocoder version: $(nanocoder --version)"

# Get help in CI/CD pipelines
nanocoder --help

# Quick version check
nanocoder -v

# Discover available options
nanocoder -h
```

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

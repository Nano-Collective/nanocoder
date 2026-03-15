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
| `--provider` | | Specify AI provider (must be configured in agents.config.json) |
| `--model` | | Specify AI model (must be available for the provider) |
| `run` | | Run in non-interactive mode |

**Provider/Model Flags:**

The `--provider` and `--model` flags allow you to specify the AI provider and model directly from the CLI, bypassing the need to use slash commands or edit configuration files. Providers must be pre-configured in your `agents.config.json` file.

If an invalid provider or model is specified, nanocoder will exit with an error message indicating the issue.

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

# Use specific provider/model for a task
nanocoder --provider openrouter --model google/gemini-3.1-flash run "analyze src/app.ts"

# Start interactive mode with specific provider
nanocoder --provider ollama --model llama3.1
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

**Starting with Specific Provider/Model:**

You can launch interactive mode with a specific provider and model using CLI flags:

```bash
# Start with specific provider
nanocoder --provider ollama

# Start with specific provider and model
nanocoder --provider openrouter --model google/gemini-3.1-flash
```

This bypasses the need to use `/provider` or `/model` slash commands on startup.

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

# With specific provider and model
nanocoder --provider openrouter --model google/gemini-3.1-flash run "analyze src/app.ts"

# Flags after 'run' command
nanocoder run --provider openrouter --model anthropic/claude-sonnet-4-20250514 "refactor database module"
```

**Non-interactive mode behavior:**

- Automatically executes the given prompt
- Runs in auto-accept mode (tools execute without confirmation)
- Displays all output and tool execution results
- Exits automatically when the task is complete
- Uses specified provider/model if `--provider` and `--model` flags are provided

**Error Handling:**

If you specify an invalid provider or model, nanocoder will exit with an error:
- Provider not found in `agents.config.json`: Shows available providers
- Model not available for provider: Shows available models for that provider

**Note:** When using non-interactive mode with VS Code integration, place any flags (like `--vscode` or `--vscode-port`) before the `run` command:

```bash
nanocoder --vscode run "your prompt"
```

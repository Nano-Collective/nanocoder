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
| `--provider` | | Specify AI provider (must be configured in agents.config.json) |
| `--model` | | Specify AI model (must be available for the provider) |
| `--context-max` | | Set maximum context length in tokens (supports k/K suffix, e.g. `128k`) |
| `--mode` | | Start in a specific [development mode](../features/development-modes.md) — `normal`, `auto-accept`, `yolo`, or `plan`. Defaults to `normal` for interactive sessions and `auto-accept` for `run` mode. |
| `--trust-directory` | | Skip the first-run directory trust prompt for this run only. Only valid with `run`; ignored (with a warning) in interactive mode. The trust is ephemeral — `trustedDirectories` in your preferences file is not modified. |
| `run` | | Run in non-interactive mode |

**Provider/Model Flags:**

The `--provider` and `--model` flags allow you to specify the AI provider and model directly from the CLI, bypassing the need to use slash commands or edit configuration files. Providers must be pre-configured in your `agents.config.json` file.

If an invalid provider or model is specified, nanocoder will show an error message indicating the issue.

**Mode Flag:**

`--mode` sets the starting [development mode](../features/development-modes.md) for both interactive and non-interactive sessions. Accepts `normal`, `auto-accept`, `yolo`, or `plan` (and the fused `--mode=<value>` form). Invalid values exit with an error.

```bash
# Interactive, yolo from the start
nanocoder --mode yolo

# Non-interactive, plan only — produce a plan without executing changes
nanocoder --mode plan run "analyze the auth module"

# Non-interactive, normal — will exit on the first tool that requires approval
nanocoder --mode normal run "refactor db module"
```

If `--mode` is omitted, interactive mode starts in `normal` and `run` mode starts in `auto-accept` (the previous defaults).

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

# With context limit override (useful when model context isn't auto-detected)
nanocoder --provider ollama --model llama3.1 --context-max 128k run "analyze src/app.ts"

# Flags after 'run' command
nanocoder run --provider openrouter --model anthropic/claude-sonnet-4-20250514 "refactor database module"
```

**Non-interactive mode behavior:**

- Automatically executes the given prompt
- Defaults to auto-accept (tools execute without confirmation); override with `--mode` (e.g. `--mode yolo` or `--mode plan`)
- Renders through a dedicated shell — no welcome banner, no boot summary, no boxed user echo, no "ctrl+r to expand" hints. Assistant text prints as plain markdown; a single spinner status line shows progress below the transcript.
- Tools render chronologically as they run (e.g. `⚒ Read 1 file`) and appear in stdout before the assistant's next response
- If a tool requires approval that auto-accept won't grant (e.g. bash in `--mode auto-accept`, or any approval-gated tool in `--mode normal`), nanocoder prints `Tool approval required for: ...` and exits with status code `1`
- Exits automatically when the task is complete
- Uses specified provider/model if `--provider` and `--model` flags are provided
- Respects `--context-max` flag or `NANOCODER_CONTEXT_LIMIT` env var for context limit override

**Skipping the directory trust prompt:**

The first time Nanocoder runs in a new directory, it shows a security disclaimer asking you to confirm you trust the code in that directory. In CI/CD or scripted contexts there's no one to confirm, so non-interactive runs would hang on the prompt — pass `--trust-directory` to bypass it for that run:

```bash
nanocoder --trust-directory run "your prompt here"
```

The override is ephemeral: it does **not** add the directory to `trustedDirectories` in your [preferences file](../configuration/preferences.md), so subsequent interactive sessions will still see the disclaimer. The flag only applies to `run`; using it without `run` prints a warning and is otherwise ignored.

**Error Handling:**

If you specify an invalid provider or model, nanocoder will show an error:
- Provider not found in `agents.config.json`: Shows available providers
- Model not available for provider: Shows available models for that provider

**Note:** When using non-interactive mode with VS Code integration, place any flags (like `--vscode` or `--vscode-port`) before the `run` command:

```bash
nanocoder --vscode run "your prompt"
```

## Next Steps

- [Installation](installation.md) - Full installation options (npm, Homebrew, Nix, development setup)
- [Uninstalling](uninstalling.md) - How to remove Nanocoder and clean up
- [Configuration](../configuration/index.md) - Set up AI providers, MCP servers, and preferences
- [Features](../features/index.md) - Custom commands, checkpointing, development modes, and more

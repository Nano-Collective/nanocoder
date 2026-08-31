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

3. **Configure** a provider when prompted, or run `/settings providers` for the interactive wizard.

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
| `--acp` | | Run as an [ACP server](../features/acp.md) for editor integration (Zed, etc.) |
| `--provider` | | Specify AI provider (must be configured in agents.config.json) |
| `--model` | | Specify AI model (must be available for the provider) |
| `--plain` | | Use the lightweight, Ink-free runtime for non-interactive runs. Requires `run`; auto-enables in CI and non-TTY environments |
| `--no-plain` | | Force the Ink runtime even in CI and non-TTY environments |
| `--json` | |Emit a single structured JSON object to `stdout` on completion instead of streamed text. Requires `run`; incompatible with `--acp` and `--vscode`|
| `--output-format` | | Set the `stdout` format, `text` or `json`. Synonym for `--json` |
| `--context-max` | | Set maximum context length in tokens (supports k/K suffix, e.g. `128k`) |
| `--mode` | | Start in a specific [development mode](../features/development-modes.md) — `normal`, `auto-accept`, `yolo`, or `plan`. Defaults to `normal` for interactive sessions and `auto-accept` for `run` mode. |
| `--trust-directory` | | Skip the first-run directory trust prompt for this run only. Only valid with `run`; ignored (with a warning) in interactive mode. The trust is ephemeral — `trustedDirectories` in your preferences file is not modified. |
| `--alt-screen` | | Start in fullscreen mode: a fixed-height layout on the alternate screen buffer with in-app scrolling. Overrides the `alternateScreen` preference for this run. |
| `--no-alt-screen` | | Force inline mode (the default), even if `alternateScreen: true` is set in your preferences file. |
| `--continue` | `-c` | Resume the most recent [saved session](../features/session-management.md) for the current directory; starts a fresh session if none exists. Interactive only — errors with `run`. Mutually exclusive with `--resume`. |
| `--resume [id]` | `-r` | Resume a [saved session](../features/session-management.md) by session ID, 1-based list index, or `last`. With no ID, opens the session picker at startup. Errors if the session is not found. Interactive only — errors with `run`. |
| `init [--preset <type>]` | | Initialize the current project. Bundled presets: `react`, `nextjs`, and `rust` |
| `run` | | Run in non-interactive mode |
| `review` | | Review a branch or PR diff for bugs, security, and style violations |

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

## Project Initialization Presets

Initialize a project from the terminal with automatic project analysis:

```bash
nanocoder init
```

Add `--preset` to seed stack-specific guidance, context ignore patterns, and a
`/check` command skill:

```bash
nanocoder init --preset react
nanocoder init --preset nextjs
nanocoder init --preset rust
```

Every preset creates an analyzed `AGENTS.md`, a `.nanocoderignore`, and
`.nanocoder/commands/check.md`. The selected preset supplies the project type
and fills in stack defaults while detected languages, package scripts, and
commands remain authoritative where applicable. Existing files are never
silently replaced: an already initialized project is refused unless `--force`
is passed, `--force` only regenerates `AGENTS.md`, and existing preset files are
preserved.

The interactive `/init` command accepts the same options, including
`/init --preset nextjs`, `/init --force`, and `/init --lean`.

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

This bypasses the need to use the `/model` slash command on startup.

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

## Code Review

Nanocoder provides AI-powered code review for branches and pull requests:

```bash
# Review a branch
nanocoder review main
nanocoder review feature/auth

# Review a PR (requires gh CLI)
nanocoder review 42
```

This fetches the diff against the default branch and runs an architect-level review identifying bugs, security issues, and style violations. You can also use `/review <target>` inside the interactive TUI.

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

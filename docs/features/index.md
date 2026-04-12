---
title: "Features"
description: "A guided tour of Nanocoder's features, from your first session to advanced workflows"
sidebar_order: 6
---

# Features

This guide walks you through Nanocoder's features in the order you'll naturally discover them — starting with the basics you'll use every session, then building up to power-user workflows.

## Your First Session

When you launch Nanocoder for the first time in a project directory, you'll see a security disclaimer asking you to trust the directory. Once confirmed, you're in an interactive chat session with your AI assistant.

Here's what you need to know right away:

### Talking to the AI

Type your message and press **Enter** to send. The AI streams its response token-by-token. If you need multi-line input, press **Ctrl+J** to add a new line (this works reliably across all terminals).

### Giving the AI Context

Use **`@`** followed by a filename to include file contents in your message. Nanocoder fuzzy-matches as you type and shows autocomplete suggestions — press **Tab** to select.

```
Can you review @src/app.tsx for any issues?
```

You can also include specific line ranges:

```
What does this function do? @src/utils.ts:45-80
```

### Running Shell Commands

Prefix any command with **`!`** to run it directly in your shell without leaving Nanocoder. The output becomes context for the AI.

```
!git status
!npm test
```

### Keyboard Shortcuts

These are the shortcuts you'll use constantly:

| Action | Shortcut |
|--------|----------|
| Submit prompt | Enter |
| New line | Ctrl+J |
| Toggle development mode | Shift+Tab |
| Cancel AI response | Esc |
| Clear input | Esc (twice) |
| Toggle compact tool output | Ctrl+O |
| Navigate prompt history | Up/Down |

See the full [Keyboard Shortcuts](keyboard-shortcuts.md) reference for platform-specific alternatives.

### Slash Commands

Type `/` to see available commands. A few essentials:

- `/help` — list all commands
- `/status` — see your current provider, model, and context usage
- `/model` — switch models
- `/clear` — start fresh

See the full [Commands Reference](commands.md) for every available command.

## Controlling Tool Execution

When the AI wants to edit a file, run a command, or perform any action, it uses **tools**. How those tools execute depends on your current [development mode](development-modes.md):

| Mode | Behaviour | Best For |
|------|-----------|----------|
| **Normal** (default) | Confirm each tool before it runs | Unfamiliar codebases, sensitive operations |
| **Auto-Accept** | Most tools execute immediately; bash and destructive git still prompt | Trusted tasks, faster iteration |
| **Yolo** | Every tool executes immediately — no exceptions | Zero interruptions, full trust |
| **Plan** | Tools are shown but never executed | Exploring what the AI would do |

Toggle between modes with **Shift+Tab**. The current mode is shown in the status bar.

## Non-Interactive Mode

For scripting and automation, run Nanocoder without an interactive session:

```bash
nanocoder run "Add error handling to src/api.ts"
```

This submits the prompt, auto-accepts all tool calls, and exits when complete. Useful for CI pipelines, git hooks, or chaining with other CLI tools.

## Managing Long Conversations

As your conversation grows, you'll want tools to keep it manageable.

### Context Compression

Every message adds to your context window. When it fills up, the AI loses access to earlier messages. [Context compression](context-compression.md) solves this:

- `/compact` — manually compress older messages while preserving recent context and key decisions
- **Auto-compact** — automatically compresses when context reaches a threshold (configurable in `agents.config.json`)
- `/usage` — see a visual breakdown of your current context utilization

### Checkpointing

Before trying a risky approach, save a [checkpoint](checkpointing.md):

```bash
/checkpoint create before-refactor
# ... try something experimental ...
/checkpoint load before-refactor    # roll back if it didn't work
```

Checkpoints save your conversation history, modified files, and model configuration.

### Session Management

Nanocoder [automatically saves your sessions](session-management.md) so you can pick up where you left off:

```bash
/resume         # browse recent sessions
/resume last    # jump back into the most recent one
```

Sessions are saved every 30 seconds by default and kept for 30 days.

## Tracking Complex Work

For multi-step tasks, the [task management](task-management.md) system keeps you and the AI aligned:

```bash
/tasks add Implement authentication
/tasks add Write tests for auth module
/tasks add Update API documentation
```

The AI also has access to task tools and will proactively create and update tasks when working on involved problems.

## Customizing Nanocoder

### Project Setup with `/init`

Run `/init` to analyze your project and generate an `AGENTS.md` file — a project-specific prompt that gives the AI context about your codebase, conventions, and tooling. Use `/init --force` to regenerate it.

The `AGENTS.md` file is automatically loaded every session, so the AI always knows how your project works.

### Custom Commands

[Custom commands](custom-commands.md) let you save reusable prompts as markdown files. Create them in `.nanocoder/commands/`:

```bash
/commands create review-code
```

Commands support parameters (`{{filename}}`), aliases, auto-injection based on keywords, and namespace organization via subdirectories. Once created, invoke them like any slash command:

```bash
/review-code src/app.ts
```

### File Explorer

The [file explorer](file-explorer.md) gives you an interactive tree view of your project for browsing and selecting files as context:

```bash
/explorer
```

Navigate with arrow keys, select files with **Space**, search with **`/`**, and press **Esc** to add your selection as `@file` mentions. It shows token estimates so you know how much context you're adding.

## Integrations

### VS Code Extension

The [VS Code extension](vscode-extension.md) bridges your editor and the CLI:

```bash
nanocoder --vscode
```

Features include live diff previews of proposed changes, right-click "Ask Nanocoder about this" for selected code, and LSP diagnostics sharing.

### MCP Servers

Extend Nanocoder's capabilities by connecting [MCP (Model Context Protocol) servers](../configuration/mcp-configuration.md). MCP servers add new tools the AI can use — from database queries to API calls to custom integrations.

```bash
/setup-mcp      # interactive setup wizard
/mcp            # see connected servers and tools
```

### Subagents

[Subagents](subagents.md) let the AI delegate focused tasks to specialized agents that run in isolated contexts. Each subagent has its own system prompt, filtered tools, and optionally a different model or provider. Only the result comes back to the main conversation.

```bash
/agents              # list available subagents
/agents create my-agent   # create a custom subagent with AI help
```

Subagents are defined as markdown files in `.nanocoder/agents/`. You can use a local model for cheap research and a cloud model for the main conversation.

### Scheduled Tasks

Automate recurring work with the [scheduler](scheduler.md):

```bash
/schedule create deps-check
/schedule add "0 9 * * MON" deps-check
/schedule start
```

Define task prompts as markdown files and schedule them with cron expressions. Nanocoder runs them non-interactively and logs the results.

## Feature Reference

| Feature | Description |
|---------|-------------|
| [Commands Reference](commands.md) | All slash commands and special input syntax |
| [Development Modes](development-modes.md) | Normal, auto-accept, yolo, and plan modes |
| [Context Compression](context-compression.md) | Managing token usage in long conversations |
| [Checkpointing](checkpointing.md) | Saving and restoring conversation snapshots |
| [Session Management](session-management.md) | Automatic session saving and resumption |
| [Task Management](task-management.md) | Tracking multi-step work |
| [Custom Commands](custom-commands.md) | Reusable AI prompts as markdown files |
| [Subagents](subagents.md) | Delegate tasks to specialized AI agents with isolated context |
| [File Explorer](file-explorer.md) | Interactive file browser for context selection |
| [Scheduler](scheduler.md) | Recurring AI tasks with cron expressions |
| [VS Code Extension](vscode-extension.md) | Editor integration with live diff previews |
| [Tune](tune.md) | Runtime model tuning for tool profiles, parameters, and compaction |
| [Desktop Notifications](notifications.md) | Get notified when Nanocoder needs your attention |
| [Keyboard Shortcuts](keyboard-shortcuts.md) | Complete keyboard shortcut reference |

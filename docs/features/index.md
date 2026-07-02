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

Type your message and press **Enter** to send. The AI streams its response token-by-token. If you need multi-line input, press **Ctrl+J** to add a new line — it's the official supported newline shortcut.

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

### Attaching Images

Press **Ctrl+V** to paste an image from your clipboard, or drag an image file into the terminal, to send it to a vision-capable model. Pending attachments show above the input box; **Ctrl+X** removes the last one. See [Image Attachments](image-attachments.md) for supported formats and platform requirements.

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

See the full [Keyboard Shortcuts](keyboard-shortcuts.md) reference for the complete shortcut list. Shift+Enter is documented there only as a terminal-dependent fallback.

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

This submits the prompt, auto-accepts tool calls, and exits when complete. Run mode uses a minimal shell (plain-markdown assistant output, chronological tool one-liners, a single status line) so output pipes cleanly into other tools.

Override the default mode with `--mode` — works both interactively and with `run`:

```bash
nanocoder --mode yolo                      # interactive, no approvals
nanocoder --mode plan run "audit auth"     # run mode, plan only
```
For structured output that's easy to parse in scripts, add `--json`: `nanocoder --plain --json run "..."` prints a single JSON object to `stdout` with the final answer, tool call log, and modified files. See [Commands → JSON Output](commands.md#json-output).

See [Commands → Non-Interactive Mode](commands.md#non-interactive-mode) and [Development Modes](development-modes.md) for details.

## Managing Long Conversations

As your conversation grows, you'll want tools to keep it manageable.

### Context Compression

Every message adds to your context window. When it fills up, the AI loses access to earlier messages. [Context compression](context-compression.md) solves this:

- `/compact` — manually compress older messages. Uses an LLM to write a structured summary by default; pass `--mechanical` for a fast regex-based fallback
- **Auto-compact** — automatically compresses when context reaches a threshold (configurable in `agents.config.json`, including the strategy)
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

### Skills: the unified extension model

**[Skills](skills.md)** are the umbrella for everything you can plug into Nanocoder — custom commands, subagents, custom tools, and event-driven triggers all live under one model. A skill is either a single `.md` file (a one-member skill) or a directory under `.nanocoder/skills/<name>/` (a bundle that ships a command + subagent + tools together).

```bash
/skills              # list every loaded skill
/skills show k8s     # inspect a skill (members, subscriptions, source)
/skills create k8s   # scaffold a new bundle
```

For most cases, you'll work at the skill level. The per-primitive pages below cover the member-specific details.

### Skill primitives

These are the kinds of members a skill can contain. Each page covers its primitive's specifics — combining them into a cohesive skill is documented in [Skills](skills.md).

- **[Custom Commands](custom-commands.md)** — reusable prompts invoked as `/command`. Support parameters, aliases, auto-injection, namespacing.
- **[Subagents](subagents.md)** — specialized AI agents the main agent can delegate to. Isolated context, filtered tools, optionally a different model.
- **[Custom Tools](custom-tools.md)** — model-callable shell scripts with declared input schemas and approval policy.
- **Event subscriptions** — cron and `file.changed` triggers that fire skill members through the per-project daemon. See [Skills → Event subscriptions](skills.md#event-subscriptions).

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

### ACP (Zed and other editors)

Run Nanocoder as an [Agent Client Protocol server](acp.md) so ACP-compatible editors like Zed can drive it as a native agent — with diffs, tool cards, permission prompts, and model switching rendered in the editor:

```bash
nanocoder --acp
```

### MCP Servers

Extend Nanocoder's capabilities by connecting [MCP (Model Context Protocol) servers](../configuration/mcp-configuration.md). MCP servers add new tools the AI can use — from database queries to API calls to custom integrations.

```bash
/setup-mcp      # interactive setup wizard
/mcp            # see connected servers and tools
```

## Feature Reference

| Feature | Description |
|---------|-------------|
| [Skills](skills.md) | **Umbrella** — unified extension model for commands, subagents, tools, and event triggers |
| [Custom Commands](custom-commands.md) | Reusable AI prompts as markdown files (a kind of skill member) |
| [Subagents](subagents.md) | Specialized AI agents with isolated context (a kind of skill member) |
| [Custom Tools](custom-tools.md) | Model-callable shell scripts (a kind of skill member) |
| [Scheduler](scheduler.md) | Migration pointer — cron triggers are now [skill subscriptions](skills.md#event-subscriptions) |
| [Commands Reference](commands.md) | All slash commands and special input syntax |
| [Development Modes](development-modes.md) | Normal, auto-accept, yolo, and plan modes |
| [Context Compression](context-compression.md) | Managing token usage in long conversations |
| [Checkpointing](checkpointing.md) | Saving and restoring conversation snapshots |
| [Session Management](session-management.md) | Automatic session saving and resumption |
| [Task Management](task-management.md) | Tracking multi-step work |
| [File Explorer](file-explorer.md) | Interactive file browser for context selection |
| [Image Attachments](image-attachments.md) | Send screenshots and images to vision-capable models |
| [VS Code Extension](vscode-extension.md) | Editor integration with live diff previews |
| [ACP](acp.md) | Run as an Agent Client Protocol server for editors like Zed |
| [Tune](tune.md) | Runtime model tuning for tool profiles, parameters, and compaction |
| [Desktop Notifications](notifications.md) | Get notified when Nanocoder needs your attention |
| [Keyboard Shortcuts](keyboard-shortcuts.md) | Complete keyboard shortcut reference |

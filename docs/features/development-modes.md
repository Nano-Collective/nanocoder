---
title: "Development Modes"
description: "Normal, auto-accept, and plan modes for controlling tool execution"
sidebar_order: 10
---

# Development Modes

When the AI needs to take an action — editing a file, running a command, searching your codebase — it makes a **tool call**. Development modes control whether those tool calls require your approval.

Toggle between modes with **Shift+Tab** during a chat session. The current mode is shown in the status bar.

## Normal Mode

The default mode. Every tool call requires your explicit confirmation before execution.

- See exactly what the AI wants to do before it happens
- Approve or reject each action individually
- Best for unfamiliar codebases, sensitive operations, or when you want full control

**When to use:** Starting a new project, working with code you don't fully understand, or when the AI is making changes you want to review carefully.

## Auto-Accept Mode

Automatically accepts and executes all tool calls without confirmation.

- Significantly faster for iterative workflows
- All tool execution results are still displayed — you can see what happened
- The AI can chain multiple actions without waiting for approval

**When to use:** Tasks you trust the AI to handle — code generation, refactoring well-understood code, running tests, or when you want to step back and let the AI work through a problem.

## Plan Mode

A dedicated exploration and planning workflow. The AI investigates your codebase using read-only tools and produces a structured plan — no files are modified, no commands are executed.

### What Happens in Plan Mode

The AI is instructed to:

1. **Investigate first** — read files, follow imports, check call sites, and understand the full picture using read-only tools
2. **Produce a structured plan** including:
   - Summary of what needs to happen and why
   - Files to modify, create, or delete
   - Step-by-step approach (numbered, ordered)
   - Dependencies and risks
   - Open questions
3. **Never make changes** — only read and search

### Available Tools

Plan mode strips out all mutation tools and keeps only read-only operations:

| Category | Tools Available |
|----------|---------------|
| **Exploration** | `read_file`, `find_files`, `search_file_contents`, `list_directory` |
| **Git (read-only)** | `git_status`, `git_diff`, `git_log` |
| **Diagnostics** | `lsp_get_diagnostics` |
| **Web** | `web_search`, `fetch_url` |
| **Interaction** | `ask_user` |

The following are **excluded**: all file mutation tools (`write_file`, `string_replace`, `delete_file`, etc.), `execute_bash`, all task management tools, and git write tools (`git_add`, `git_commit`, `git_push`, etc.).

### The Plan → Execute Workflow

Plan mode is designed as the first step of a two-phase workflow:

1. **Plan** — switch to plan mode with **Shift+Tab**, describe your task, and let the AI explore and produce a plan
2. **Execute** — switch back to normal or auto-accept mode with **Shift+Tab**, then tell the AI to execute the plan

Your conversation history (including the plan) is preserved when you switch modes, so the AI has full context when it starts executing.

### Plan Mode with Tune

When [Tune](tune.md) is active with the **minimal** profile, plan mode uses an even leaner tool set:

| Profile | Plan Mode Tools |
|---------|----------------|
| **full** | All read-only tools listed above |
| **minimal** | `read_file`, `find_files`, `search_file_contents`, `list_directory` |

This makes plan mode practical even for small models with limited tool-handling capability.

### Simplified Prompts

Plan mode also adjusts the system prompt — coding practices and constraints sections are excluded (since the AI isn't writing code), and git/diagnostics sections use read-only variants focused on gathering information rather than acting on it.

**When to use:** Understanding how to approach a complex task before committing to changes, exploring an unfamiliar codebase, or when you want a detailed plan to review and refine before execution.

---
title: "Development Modes"
description: "Normal, auto-accept, yolo, and plan modes for controlling tool execution"
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

Automatically accepts and executes most tool calls without confirmation. Some high-risk tools like bash commands still require approval.

- Significantly faster for iterative workflows
- All tool execution results are still displayed — you can see what happened
- The AI can chain multiple actions without waiting for approval
- Bash commands and destructive git operations (hard reset, force delete, stash drop/clear) still prompt for confirmation

**When to use:** Tasks you trust the AI to handle — code generation, refactoring well-understood code, running tests, or when you want to step back and let the AI work through a problem.

## Yolo Mode

Automatically accepts and executes **every** tool call without exception — including bash commands and destructive git operations.

- No confirmation prompts at all — everything runs immediately
- Bash commands, hard resets, force deletes, stash drops — all auto-accepted
- The status bar turns red to make it clear you're in yolo mode

**When to use:** When you fully trust the AI and want zero interruptions. Use with caution — there are no safety nets other than basic tool validators.

## Plan Mode

A dedicated exploration and planning workflow. The AI investigates your codebase with the tools available in plan mode and produces a structured plan — it cannot edit files, run shell commands, or perform git/task mutations.

### What Happens in Plan Mode

The AI is instructed to:

1. **Investigate first** — read files, follow imports, check call sites, and understand the full picture before proposing changes
2. **Produce a structured plan** including:
   - Summary of what needs to happen and why
   - Files to modify, create, or delete
   - Step-by-step approach (numbered, ordered)
   - Dependencies and risks
   - Open questions
3. **Do not execute changes** — plan mode is for analysis and planning only

### Available Tools

Plan mode removes mutation tools and leaves only read-only and interaction tools:

| Category | Tools Available |
|----------|---------------|
| **Exploration** | `read_file`, `find_files`, `search_file_contents`, `list_directory` |
| **Git (read-only)** | `git_status`, `git_diff`, `git_log` |
| **Diagnostics** | `lsp_get_diagnostics` |
| **Web** | `web_search`, `fetch_url` |
| **Interaction** | `ask_user`, `agent` |

The following are **excluded**: all file mutation tools (`write_file`, `string_replace`, `delete_file`, etc.), `execute_bash`, all task management tools, and git write tools (`git_add`, `git_commit`, `git_push`, `git_pull`, `git_branch`, `git_stash`, `git_reset`).

### The Plan → Execute Workflow

Plan mode is designed as the first step of a two-phase workflow:

1. **Plan** — switch to plan mode with **Shift+Tab**, describe your task, and let the AI explore and produce a plan
2. **Execute** — switch back to normal, auto-accept, or yolo mode with **Shift+Tab**, then tell the AI to execute the plan

Your conversation history (including the plan) is preserved when you switch modes, so the AI has full context when it starts executing.

### Plan Mode with Tune

When [Tune](tune.md) is active with the **minimal** profile, plan mode uses an even leaner tool set:

| Profile | Plan Mode Tools |
|---------|----------------|
| **full** | All plan-mode tools listed above |
| **minimal** | `read_file`, `find_files`, `search_file_contents`, `list_directory` |

Because the minimal tune profile already limits the available tools, `ask_user`, `agent`, diagnostics, web tools, and git tools are not available in that configuration.

### Simplified Prompts

Plan mode also adjusts the system prompt — coding practices and constraints sections are excluded (since the AI isn't writing code), and git/diagnostics sections use read-only variants focused on gathering information rather than acting on it.

**When to use:** Understanding how to approach a complex task before committing to changes, exploring an unfamiliar codebase, or when you want a detailed plan to review and refine before execution.

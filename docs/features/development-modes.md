---
title: "Development Modes"
description: "Normal, auto-accept, yolo, and plan modes for controlling tool execution"
sidebar_order: 10
---

# Development Modes

When the AI needs to take an action — editing a file, running a command, searching your codebase — it makes a **tool call**. Development modes control whether those tool calls require your approval.

Toggle between modes with **Shift+Tab** during a chat session. The current mode is shown in the status bar.

You can also boot directly into a specific mode with `--mode`, which works in both interactive and non-interactive runs:

```bash
nanocoder --mode yolo                    # interactive, yolo
nanocoder --mode plan run "audit auth"   # run mode, plan only
nanocoder --mode=auto-accept             # fused form also works
```

Accepts `normal`, `auto-accept`, `yolo`, or `plan`. Invalid values exit with an error. When `--mode` is omitted, interactive sessions default to `normal` and `run` mode defaults to `auto-accept`.

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

- No tool confirmation prompts at all — everything runs immediately
- Bash commands, hard resets, force deletes, stash drops — all auto-accepted
- The status bar turns red to make it clear you're in yolo mode
- One safeguard remains: if the model repeats the identical tool call too many times in a row, Nanocoder pauses and asks whether to continue, so a stuck loop cannot drain tokens unattended. See [Retry Limits](../configuration/index.md#retry-limits)

**When to use:** When you fully trust the AI and want zero interruptions. Use with caution — there are no safety nets other than basic tool validators and the repeated-call pause above.

## Plan Mode

A dedicated exploration and planning workflow. The AI investigates your codebase with the tools available in plan mode and produces a structured plan, which is saved so you can read and approve it before anything runs. It cannot edit files, run shell commands, or perform git/task mutations.

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
| **Plan artifact** | `write_plan` |

`write_plan` is the one write plan mode allows, and it only ever writes to the session's own artifact directory — never to your project. It exists in plan mode only; the other modes do not have it.

The following are **excluded**: all file mutation tools (`write_file`, `string_replace`, `delete_file`, etc.), `execute_bash`, the task and walkthrough tools (`write_tasks`, `write_walkthrough`), and git write tools (`git_add`, `git_commit`, `git_push`, `git_pull`, `git_branch`, `git_stash`, `git_reset`).

MCP tools follow the same rule. An MCP tool is available in plan mode only when its server annotates it read-only (`readOnlyHint` in the tool's MCP annotations); anything unannotated is treated as a possible mutation and hidden. A server's [`alwaysAllow`](../configuration/mcp-configuration.md#auto-approve-tools) list does not override this — it applies in normal mode only.

### The Plan → Review → Execute Workflow

Plan mode is designed as the first step of a two-phase workflow:

1. **Plan** — switch to plan mode with **Shift+Tab** and describe your task. The AI explores, produces a plan, and saves it with `write_plan`. If the model finishes without calling the tool, its written plan is saved for you.
2. **Review** — a review prompt appears when the turn completes:
   - **Yes, execute this plan** — leaves plan mode, switches to normal mode, and starts implementation with the saved plan attached to the request
   - **No, tell Nanocoder what to change** — stays in plan mode so you can ask for revisions
   - **Ask me clarifying questions** — stays in plan mode and has the AI ask follow-up questions first
   - **Esc** — same as *No*. Plan mode is never exited implicitly
3. **Execute** — implementation runs in normal mode

The saved plan is reachable at any time from the **Plan** shortcut above the prompt (Cmd/Ctrl+click to open it). Approving sends the plan text along with the request, so a model that has lost the plan from its context window still has it. Your conversation history is preserved across the mode switch either way.

After implementing an approved plan, the AI is asked to record a **Walkthrough** with `write_walkthrough` — the files it changed, the tests it actually ran, and how to verify the result. It appears as a third shortcut above the prompt.

### Session Artifacts

Plan mode writes to the session's artifact directory under the app data path, never into your repository:

| Shortcut | File | Written by |
|----------|------|-----------|
| **Plan** | `implementation_plan.md` | `write_plan` in plan mode |
| **Tasks** | `task.md` | `write_tasks` while implementing |
| **Walkthrough** | `walkthrough.md` | `write_walkthrough` after implementing |

Artifacts are restored when you resume a session and are deleted along with it. See [Session Management](session-management.md).

### Plan Mode with Tune

When [Tune](tune.md) is active with the **minimal** profile, plan mode uses an even leaner tool set:

| Profile | Plan Mode Tools |
|---------|----------------|
| **full** | All plan-mode tools listed above |
| **minimal** | `read_file`, `find_files`, `search_file_contents`, `list_directory`, `write_plan` |
| **nano** | `read_file`, `search_file_contents`, `write_plan` |

Because the minimal tune profile already limits the available tools, `ask_user`, `agent`, diagnostics, web tools, and git tools are not available in that configuration. `write_plan` is the exception: plan mode adds it back on every profile, so the review-and-approve flow works the same for small local models.

### Simplified Prompts

Plan mode also adjusts the system prompt — coding practices and constraints sections are excluded (since the AI isn't writing code), and git/diagnostics sections use read-only variants focused on gathering information rather than acting on it.

**When to use:** Understanding how to approach a complex task before committing to changes, exploring an unfamiliar codebase, or when you want a detailed plan to review and refine before execution.

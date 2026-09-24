---
title: "Development Modes"
description: "Normal, auto-accept, yolo, plan, and architect modes for controlling tool execution"
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

Accepts `normal`, `auto-accept`, `yolo`, `plan`, or `architect`. Invalid values exit with an error. When `--mode` is omitted, interactive sessions default to `normal` and `run` mode defaults to `auto-accept`.

## Choosing a Mode

The modes differ along two axes: whether each tool call is gated, and whether anything reaches disk.

| Mode | Per-tool approval | Reaches disk | Review point |
|------|------------------|--------------|--------------|
| **Normal** | Every tool | Yes | Before each call |
| **Auto-accept** | Bash and destructive git only | Yes | Before risky calls |
| **Yolo** | None | Yes | None |
| **Plan** | N/A — cannot mutate | No | The plan, before any work |
| **Architect** | Bash and destructive git only | Yes | The whole turn, after it runs |

Plan and architect are the two reviewing modes, and they review different things. Plan reviews a *proposal* before any work happens. Architect lets the work happen and reviews the *result*, with a one-keypress undo.

## Normal Mode

The default mode. Every tool call requires your explicit confirmation before execution.

- See exactly what the AI wants to do before it happens
- Approve or reject each action individually
- Approval cards for `execute_bash`, `string_replace`, `write_file`, `diff_edit`, and `file_op` can show a one-line description of the model's intent above the command or path, when the model supplies one
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

**When to use:** When you fully trust the AI and want zero interruptions. Use with caution — yolo skips the confirm prompt. File tools still stay inside the project; `execute_bash` does not unless you turn on `nanocoder.sandbox` (writes and network only — see [Configuration](../configuration/index.md#os-sandbox)).

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

The following are **excluded**: all file mutation tools (`write_file`, `string_replace`, `diff_edit`, `lsp_format_document`, `delete_file`, etc.), `execute_bash`, the task and walkthrough tools (`write_tasks`, `write_walkthrough`), and git write tools (`git_add`, `git_commit`, `git_push`, `git_pull`, `git_branch`, `git_stash`, `git_reset`).

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

## Architect Mode

Review a whole turn's changes as a unit, with a one-keypress undo, instead of approving edits one at a time.

The AI works through your request without stopping for per-file confirmation. When the turn finishes, a review bar shows everything it touched and asks what you want to do with the batch.

### What Happens in Architect Mode

1. **The first file mutation of a turn takes a checkpoint** — a snapshot of every file the turn is about to touch, captured before it is modified. Files that do not exist yet are recorded as such, so reverting deletes them rather than leaving them behind.
2. **Tools execute for real** — nothing is held back or buffered. The AI reads back what it wrote, notices its own mistakes, and fixes them before you ever see the result.
3. **Later mutations extend the same checkpoint** — one logical checkpoint covers the whole turn, including files first touched partway through.
4. **The review bar appears at turn completion** with the files changed and the files created.

### Review Options

| Option | What it does |
|--------|-------------|
| **Keep** | Leaves everything in place and releases the checkpoint |
| **Revert** | Restores every file to its pre-turn contents and deletes files the turn created |
| **Revert & Revise** | Reverts, then asks for revision instructions and starts a new turn with them |
| **Esc** | Same as Keep |

Reverting also tells the AI what happened, so its next turn does not try to edit files against a state that no longer exists.

Revert restores files. It does not undo side effects — a `git push`, a deleted branch, or anything a bash command did to the world outside your working tree. That is why bash still prompts.

### Approval Posture

Architect waives per-call approval for file mutation tools only. Everything with a side effect a checkpoint cannot undo still prompts exactly as it does in normal mode:

- **Waived** — `write_file`, `string_replace`, `diff_edit`, `file_op`, `lsp_format_document`, and any custom tool that mutates files
- **Still prompts** — `execute_bash` and destructive git operations

Gating a turn twice would make architect worse than normal mode rather than better, so the batching only pays off if the turn runs uninterrupted.

### Excluded Tools

Architect removes the tools that would commit work past the review gate or write a plan artifact outside the plan workflow: `git_commit`, `git_pr`, and `write_plan`. Committing sits on the far side of a gate whose whole purpose is that you might revert.

### Checkpoints

Architect checkpoints are the same mechanism as `/checkpoint`, created and released automatically. Each turn's checkpoint is deleted once you resolve the review bar, so they do not accumulate in `/checkpoint list`.

If a checkpoint cannot be written — an unwritable directory, a full disk — the turn still runs and a warning is logged. The review bar will not offer revert for that turn.

**When to use:** Multi-file refactors where approving each edit is noise, work you want to judge as a whole rather than step by step, or any time you would rather see the finished result and undo it than gate every step on the way there.

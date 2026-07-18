---
title: "Commands"
description: "Complete reference of built-in slash commands and special input syntax"
sidebar_order: 5
---

# Commands Reference

Type `/` in the chat input to see available commands. All commands start with `/` and can be invoked at any point during a session.

## Built-in Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/init` | Initialize project with intelligent analysis, create AGENTS.md and configuration files. Use `/init --force` to regenerate AGENTS.md if it already exists, or `/init --lean` to skip merging `CLAUDE.md` content into the generated AGENTS.md |
| `/setup-providers` | Interactive wizard for configuring AI providers with templates |
| `/setup-mcp` | Interactive wizard for configuring MCP servers with templates |
| `/setup-config` | Open a configuration file in your `$EDITOR` (lists project and global config files) |
| `/clear` | Clear chat history |
| `/model` | Switch between available models from any configured provider |
| `/status` | Display current status (CWD, provider, model, theme, available updates, AGENTS setup) |
| `/tasks` | Manage task list for tracking complex work (see [Task Management](task-management.md)) |
| `/model-database` | Browse coding models from OpenRouter (searchable, filterable by open/proprietary) |
| `/settings` | Interactive menu to access Nanocoder settings (theme, title-shape, nanocoder-shape, paste-threshold) |
| `/mcp` | Show connected MCP servers and their tools |
| `/custom-commands` | List all custom commands |
| `/checkpoint` | Save and restore conversation snapshots (see [Checkpointing](checkpointing.md)) |
| `/compact` | Compress message history to reduce context usage (see [Context Compression](context-compression.md)) |
| `/context-max` | Set maximum context length for the current session, or inspect the resolved context source. Also available as `--context-max` CLI flag |
| `/exit` | Exit the application |
| `/export` | Export current session to markdown file |
| `/copy` | Copy the last assistant response to the system clipboard |
| `/doctor` | Show environment health report for bug reports |
| `/update` | Update Nanocoder to the latest version |
| `/usage` | Get current model context usage visually |
| `/lsp` | List connected LSP servers |
| `/schedule` | Read-only view of cron subscriptions declared by skills (see [Skills → Event subscriptions](skills.md#event-subscriptions)) |
| `/skills` | List and inspect loaded skills; scaffold new bundle skills with AI assistance (see [Skills](skills.md)) |
| `/resume` | Resume a previous chat session (aliases: `/sessions`, `/history`). Also available at launch via the `--resume`/`--continue` CLI flags. See [Session Management](session-management.md) |
| `/retry` | Re-run the last user turn. Use `/retry --model <id>` or `/retry --provider <name> --model <id>` to switch models first |
| `/rename` | Rename the current session. Name must be non-empty and 100 characters or less. See [Session Management](session-management.md) |
| `/explorer` | Interactive file browser to navigate, preview, and select files for context |
| `/tune` | Configure runtime model behaviour — tool profiles, compaction, native tools, model parameters (see [Tune](tune.md)) |
| `/ide` | Connect to an IDE for live integration (e.g., VS Code diff previews) |

## Special Input Syntax

These shortcuts work directly in the chat input — no `/` prefix needed.

| Syntax | Description |
|--------|-------------|
| `!command` | Execute bash commands directly without leaving Nanocoder (output becomes context for the LLM) |
| `@file` | Include file contents in messages via fuzzy search — press Tab to select from suggestions |
| `@file:10-20` | Include specific line range from a file (line 10 to 20) |
| `@file:10` | Include a single line from a file |

### File Mentions

The `@` syntax triggers real-time fuzzy matching as you type. Nanocoder searches your project files (respecting `.gitignore`) and shows autocomplete suggestions. Press **Tab** to accept a suggestion.

You can narrow the context by specifying line ranges:

```
What does this function do? @src/utils.ts:45-80
Explain the error on @src/app.tsx:23
```

### Shell Commands

The `!` prefix runs a command in your shell and includes the output as context for the AI:

```
!git log --oneline -10
!npm test -- --filter auth
```

## Non-Interactive Mode

Run Nanocoder without an interactive session for scripting and automation:

```bash
nanocoder run "Add error handling to src/api.ts"
```

This submits the prompt and exits when complete. Useful for CI pipelines, git hooks, or chaining with other tools.

Run mode renders through a dedicated minimal shell: no welcome banner, no boxed "You:" echo, no trailing token counts, no `ctrl+r to expand` hints. Assistant text streams as plain markdown, tools render chronologically as one-liners (e.g. `⚒ Read 1 file`), and a single status line below the transcript shows progress.

By default, `run` uses auto-accept. Override with `--mode` to boot into a different [development mode](development-modes.md):

```bash
# Plan only — no changes executed
nanocoder --mode plan run "analyze the auth module"

# No safety rails — auto-accepts every tool including bash
nanocoder --mode yolo run "update README and push"
```

If a tool requires approval that the active mode won't grant, nanocoder prints `Tool approval required for: ...` and exits with status code `1`.
### JSON Output

For CI pipelines, scripting, and tool chaining, pass `--json` (alias `--output-format json`) alongside `run` to get a single structured JSON object on `stdout` instead of streamed markdown:

```bash
nanocoder --plain --json run "Add error handling to src/api.ts"
```

With `--json` set, all human-readable output — boot banners, streamed tokens, tool one-liners, status lines — is suppressed from `stdout`. Anything nanocoder would otherwise print is instead routed to `stderr`, so `stdout` stays clean for piping:

```bash
nanocoder --plain --json run "refactor the auth module" | jq .finalText
```

`--json` requires `run` and is incompatible with `--acp` and `--vscode` — combining them exits with an error before the session starts.

#### Output Shape

The emitted object looks like:

```json
{
  "outcome": "success",
  "finalText": "...",
  "reasoning": "...",
  "toolCalls": [
    {
      "name": "edit_file",
      "arguments": { "path": "src/api.ts" },
      "result": "...",
      "error": null
    }
  ],
  "modifiedFiles": ["src/api.ts"]
}
```

- `outcome` — `"success"`, `"tool-approval-required"`, or `"error"`, matching the underlying conversation result
- `finalText` — the model's final response text
- `reasoning` — accumulated reasoning/thinking content, or `null` if the model didn't emit any
- `toolCalls` — every tool call made during the run, each with its arguments and either a `result` or an `error` (never both)
- `modifiedFiles` — deduplicated list of file paths touched by file-mutating tools (`write_to_file`, `create_file`, `string_replace`, `edit_file`)

On error (e.g. an untrusted workspace directory, or the turn limit being hit without a final answer), `outcome` is `"error"` and the object still includes whatever `toolCalls` were captured before the failure, so partial progress isn't silently dropped.

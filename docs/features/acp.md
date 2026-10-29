---
title: "ACP (Editor Integration)"
description: "Run Nanocoder as an Agent Client Protocol server for editors like Zed and the VS Code sidebar"
sidebar_order: 9
---

# ACP (Agent Client Protocol)

Nanocoder can run as an [Agent Client Protocol](https://agentclientprotocol.com) (ACP) server, letting ACP-compatible clients drive it as a native coding agent. Instead of the Ink terminal UI, Nanocoder speaks JSON-RPC over stdin/stdout, and the client renders the conversation, tool calls, diffs, and permission prompts in its own UI.

```bash
nanocoder --acp
```

You normally don't run this command yourself — the editor or extension spawns it for you (see [Setup in Zed](#setup-in-zed) and the [VS Code extension](vscode-extension.md)).

## ACP vs. the VS Code companion

ACP is the transport for both the **VS Code sidebar chat** and other ACP clients (Zed, etc.). The older `--vscode` WebSocket path is a separate, opt-in **legacy terminal companion** for Ink TUI sessions — not how the sidebar works.

| | Transport | Flag | Clients |
| --- | --- | --- | --- |
| **ACP** | JSON-RPC over stdin/stdout | `--acp` | VS Code sidebar, Zed, and other ACP clients |
| **Legacy companion** | WebSocket | `--vscode` | VS Code (opt-in terminal companion) |

With ACP the **client is the UI**: the agent runs headless and everything (streaming text, tool cards, diffs, approvals) is rendered by the editor or sidebar. The legacy `--vscode` companion keeps the Nanocoder terminal TUI in charge and adds diff previews and editor context on top — see [Legacy Companion Mode](vscode-extension.md#legacy-companion-mode).

## What works over ACP

- **Streaming responses** including reasoning/thinking, rendered in the editor's agent panel.
- **Tool calls with rich cards** — file tools report their kind and the files they touch, and edits (`string_replace`, `write_file`) include a **before/after diff** the editor can preview.
- **Permission prompts** — tools that need approval surface as the editor's own allow/deny prompt, respecting the current [development mode](development-modes.md).
- **Approval policy** — tools in an [`alwaysAllow`](../configuration/index.md#tool-auto-approval) list (the top-level one, or an MCP server's) never prompt in `normal` mode. The `session/new`, `session/load` and `session/resume` responses list the offered tools that skip the prompt this way under `_meta["nanocoder/approval"].alwaysAllow`, so a client can show them. The report does not change how approvals are decided.
- **Development modes** — `normal`, `auto-accept`, `yolo`, `plan`, and `architect` are exposed as ACP session modes and selectable from the editor (sessions start in `auto-accept`, which still asks before bash commands and before `file_op` deletes a file or overwrites one with a move or copy). Pass `--mode <mode>` in `args` to start every session in another mode. An unknown mode ID is rejected with an invalid-params error and leaves the mode unchanged, and each change is confirmed with a `current_mode_update` notification.
- **Model display and switching** — the editor shows the current model and lets you switch between the models configured for your active provider.
- **`ask_user`** — when the agent asks a clarifying question, the options appear as selectable buttons in the editor. (Selection only; a free-form typed answer is not available over ACP.)
- **`@`-mentioned files** — files you reference in the editor are read and included in the prompt, using the editor's live buffer (including unsaved edits) when available.
- **Session persistence** - ACP sessions are saved to disk like TUI sessions (see [Session Management](session-management.md)). Loading or resuming a thread replays its history, even after the editor and agent restart. Loading or resuming a session ID that is neither in memory nor on disk fails with `Session not found on disk: <id>` instead of creating an empty session; only `session/new` creates one.
- **Session management** - clients can list, resume, close and delete sessions. Nanocoder also answers a `_nanocoder/renameSession` extension method (`sessionId`, `title`; see [Extension methods](#extension-methods)), and new sessions get a generated title from the first message.
- **Turning tools off for a session** - an editor that provides its own version of a tool, such as a browser, can ask Nanocoder not to offer the built-in one: send `_meta: {"nanocoder/disabledTools": ["browser"]}` on `session/new`, `session/load` or `session/resume`. The names are added to your own [`disabledTools`](../configuration/index.md#disabling-tools), never replacing it, and apply to that session only: the tools are left out of the tool list and the prompt, a call the model makes to one anyway is refused with an error and nothing runs, and subagents the session starts respect the same list. Other sessions are unaffected, and your config files are never read or changed for this. The response `_meta` reports the list in effect under the same key (yours and the editor's), so an editor can check that it was honoured. It is not saved with the session, so send it on every new, load and resume (a load or resume without it turns nothing off). A name that is not a known tool is ignored, and left out of the reported list.
- **Images** - PNG, JPEG, GIF and WebP attachments are sent to the model as images.

## Extension methods

ACP reserves method names starting with `_` for custom methods. Nanocoder's are:

| Method | Params | What it does |
|--------|--------|--------------|
| `_nanocoder/renameSession` | `sessionId`, `title` | Sets a session's title |
| `_nanocoder/timeline/list` | `sessionId` | Lists the session's file-change checkpoints, including which `filesChanged` were `createdFiles` and the `turnId` of the prompt that made them |
| `_nanocoder/timeline/revert` | `sessionId`, `checkpointId` | Reverts the files and history to before a checkpoint |
| `_nanocoder/timeline/read` | `sessionId`, `checkpointId`, `path` | Reads a file as it was just before a checkpoint's tool call (read-only; see [Reading before-images](#reading-before-images)) |
| `_nanocoder/retryTurn` | `sessionId`, optional `promptText` | Removes the last turn so the prompt can be sent again |
| `_nanocoder/cancelSubagent` | `sessionId`, `childRunId` | Cancels one running subagent; the turn and the other subagents carry on (see [Subagent events](#subagent-events)) |

The agent also sends two notifications: `_nanocoder/sessionTitleChanged` when it titles a session in the background, and `_nanocoder/subagent` as each subagent run progresses (see [Subagent events](#subagent-events)).

**Capability detection.** `initialize` lists the exact names under `agentCapabilities._meta.nanocoder`:

```json
{"nanocoder": {"extMethods": ["_nanocoder/renameSession", "..."], "extNotifications": ["_nanocoder/sessionTitleChanged", "_nanocoder/subagent"]}}
```

Take the names from that list as they are rather than building them from a prefix. An agent that doesn't list a method doesn't support it under that name.

**Deprecated aliases.** The first four methods are still answered under their old bare names (`renameSession`, `timeline/list`, `timeline/revert`, `retryTurn`) for clients that predate the prefix. Methods added since, such as `timeline/read` and `cancelSubagent`, have no bare name. The first use of each logs a deprecation notice. The aliases will be removed in a later release, announced in the changelog.

**Unknown methods.** A custom request the agent doesn't recognise fails with the standard JSON-RPC "Method not found" error (`-32601`), so "not supported" can be told apart from "failed".

### Reading before-images

`_nanocoder/timeline/read` returns the saved copy of one file from just before a checkpoint's tool call. It only reads: files, history and the checkpoint index are not touched. The result is one of:

- `{"kind": "text", "content": "..."}` - the file's contents before the call.
- `{"kind": "created"}` - the file did not exist before the call, so there is no before-image.
- `{"kind": "unavailable", "reason": "..."}` - there is nothing to return. This covers a checkpoint that was reverted or pruned, a path the checkpoint does not hold, a binary file, and a saved copy that is missing from disk.

`path` is relative to the session's working directory, or an absolute path inside it. A path outside the working directory fails with an error. The session must be loaded, as for `timeline/list`.

**Finding the baseline for a turn.** Each checkpoint is one tool call, and one prompt can make many of them over several model round-trips. `truncateToMessageIndex` does not mark a turn: it moves forward with every round-trip, so two edits the agent makes for one prompt can carry different values. Use `turnId` instead. Every checkpoint recorded while the agent works on one prompt has the same `turnId` in `timeline/list`.

The file as it was before the agent's turn is the before-image from the checkpoint with the lowest `seq` among those that share the turn's `turnId` and whose `filesChanged` contains the path. If that checkpoint also lists the path in `createdFiles`, the file did not exist before the turn. Checkpoints recorded by an older Nanocoder have no `turnId`, so their turns cannot be told apart. If the turn's earliest checkpoints were pruned (see the limits below), the earliest one left may already include the agent's own earlier edits.

Use `createdFiles` from `timeline/list` to tell a created file from an edited one without a read.

**Limits.**

- Binary files are never saved, so they always read as `unavailable`.
- A session keeps at most 50 checkpoints; older ones read as `unavailable`. Reverting deletes the reverted turn's checkpoints and every later one, so those read as `unavailable` too.
- Timelines of sessions untouched for 7 days, or beyond the 20 most recent, are pruned.
- A shell command or other tool whose targets are not known up front gets a checkpoint only when the Git scan of the workspace before and after the call is complete. A scan that hit its file cap, or that could not run, records none.
- There is no size cap: a large text file is returned whole.

### Subagent events

When the agent delegates to a subagent, the parent `agent` tool call's title is refreshed with progress, and the subagent's own tool calls appear as `subagent:` cards, as before. A client that wants each subagent as its own run can also read the `_nanocoder/subagent` notifications, which carry:

| Field | Meaning |
|-------|---------|
| `sessionId` | The session the run belongs to |
| `toolCallId` | The parent's `agent` tool call that started the run |
| `childRunId` | Identifies the run for as long as it lives |
| `parentRunId` | The run that started this one; empty for a child of the turn |
| `name` | The subagent's name |
| `status` | `started`, `progress`, `completed`, `failed` or `cancelled` |
| `tokenCount`, `toolCallCount`, `lastTool` | Progress, on `progress` and `completed` events |
| `result` | The subagent's final output, on `completed` |
| `error` | Why the run ended, on `failed` and `cancelled` |

Every run sends `started`, then any number of `progress`, then exactly one of `completed`, `failed` or `cancelled`. Runs that overlap each send their own events; tell them apart by `childRunId`. A client that ignores the notification sees nothing different.

**Cancelling one run.** `_nanocoder/cancelSubagent` with the `sessionId` and `childRunId` ends that run and returns `{"cancelled": true}`. The run reports `cancelled`, its parent `agent` call gets a "Subagent was cancelled" result, and the turn and the other subagents carry on. It returns `{"cancelled": false}` when there is nothing to cancel: the run already ended, or belongs to another session. Cancelling the turn with `session/cancel` still cancels every run.

**Approvals.** The permission request for a subagent's tool call (its tool call ID starts with `subagent:`) carries the run in the request's `_meta` as `nanocoder/childRunId`.

## Setup in Zed

[Zed](https://zed.dev) is the reference ACP client. Register Nanocoder as a custom agent in Zed's `settings.json` (`Cmd+,`, or **zed: open settings** from the command palette):

```json
{
  "agent_servers": {
    "Nanocoder": {
      "command": "nanocoder",
      "args": ["--acp"]
    }
  }
}
```

Then:

1. Open a project folder in Zed (one that has a Nanocoder provider configured — see [Requirements](#requirements)).
2. Open the **Agent Panel** and use the **New Thread** dropdown.
3. Choose **Nanocoder** and start prompting.

To pin a specific provider or model for the editor session, add them to `args`:

```json
{
  "agent_servers": {
    "Nanocoder": {
      "command": "nanocoder",
      "args": ["--acp", "--provider", "ollama", "--model", "qwen2.5-coder:7b"]
    }
  }
}
```

Otherwise Nanocoder uses your configured default provider and last-used model. You can switch models later from Zed's model selector.

## Requirements

- Nanocoder installed and on your `PATH` (a global install puts `nanocoder` on `PATH`).
- A configured provider. The ACP server resolves provider and model the same way the CLI does — from the project's `agents.config.json` (or your global config). See [Providers](../configuration/providers/index.md).
- Each session works in the directory the editor names for it (the `cwd` in `session/new`), even if the agent process was started somewhere else. Relative paths, `execute_bash`, the git tools, the project boundary for file tools, the system prompt and `AGENTS.md` all follow that directory, and a `cd` in one session does not move another.
- Project-level configuration (`agents.config.json`, MCP servers, custom tools and skills) is read once, from the directory the agent process starts in, so editors should still spawn the agent in your **project directory**. Plugins are the exception: each session loads `.nanocoder/plugins/` from its own directory (see [Hooks](hooks.md)).

## Limitations

- **`ask_user` is selection-only.** ACP permission options have no text input, so the model receives whichever option you pick rather than a typed answer.
- **Audio and other image types are not processed.** Audio, and images other than PNG, JPEG, GIF and WebP, are noted to the model but not sent.

## Troubleshooting

**Nanocoder doesn't appear / the thread fails to start**

- Confirm `nanocoder --acp` runs from your shell. If the editor was launched from the desktop (not a terminal), it may not see your shell's `PATH` — use an absolute path to the binary, or to the Node runtime, in the `command`/`args`.
- Check the editor's agent/log output for the spawn error.

**"Directory ... is not trusted" and it exits immediately**

- `nanocoder --acp` refuses a directory you haven't trusted, because it loads that directory's `agents.config.json`, hooks and MCP servers. Trust the folder by running `nanocoder` there once, set `NANOCODER_TRUST_DIRECTORY=1`, or add `--trust-directory` to the editor's `args` for a one-off. The VS Code extension adds it for you when the workspace is trusted in VS Code.

**"No provider configured" or it exits immediately**

- The open folder has no resolvable provider/model. Add an `agents.config.json` to the project (or your global config), or pass `--provider`/`--model` in `args`. See [Configuration](../configuration/index.md).

**Tagged files aren't seen by the model**

- Make sure you reference the file through the editor's own file-mention UI so it sends the file as a resource. Plain text that merely names a path is not read automatically.

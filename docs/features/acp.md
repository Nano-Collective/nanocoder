---
title: "ACP (Editor Integration)"
description: "Run Nanocoder as an Agent Client Protocol server for editors like Zed"
sidebar_order: 9
---

# ACP (Agent Client Protocol)

Nanocoder can run as an [Agent Client Protocol](https://agentclientprotocol.com) (ACP) server, letting ACP-compatible editors drive it as a native coding agent. Instead of the Ink terminal UI, Nanocoder speaks JSON-RPC over stdin/stdout, and the editor renders the conversation, tool calls, diffs, and permission prompts in its own UI.

```bash
nanocoder --acp
```

You normally don't run this command yourself — the editor spawns it for you (see [Setup in Zed](#setup-in-zed) below).

## ACP vs. the VS Code extension

Both connect Nanocoder to an editor, but they are different mechanisms — pick the one your editor supports:

| | Transport | Flag | Editors |
| --- | --- | --- | --- |
| **ACP** | JSON-RPC over stdin/stdout | `--acp` | Zed and other ACP clients |
| **[VS Code extension](vscode-extension.md)** | WebSocket | `--vscode` | VS Code |

With ACP the **editor is the UI**: the agent runs headless and everything (streaming text, tool cards, diffs, approvals) is rendered by the editor. With the VS Code extension, the Nanocoder terminal UI stays in charge and the editor adds diff previews and editor context on top.

## What works over ACP

- **Streaming responses** including reasoning/thinking, rendered in the editor's agent panel.
- **Tool calls with rich cards** — file tools report their kind and the files they touch, and edits (`string_replace`, `write_file`) include a **before/after diff** the editor can preview.
- **Permission prompts** — tools that need approval surface as the editor's own allow/deny prompt, respecting the current [development mode](development-modes.md).
- **Development modes** — `normal`, `auto-accept`, `yolo`, and `plan` are exposed as ACP session modes and selectable from the editor (sessions start in `auto-accept`).
- **Model display and switching** — the editor shows the current model and lets you switch between the models configured for your active provider.
- **`ask_user`** — when the agent asks a clarifying question, the options appear as selectable buttons in the editor. (Selection only; a free-form typed answer is not available over ACP.)
- **`@`-mentioned files** — files you reference in the editor are read and included in the prompt, using the editor's live buffer (including unsaved edits) when available.
- **Session reload** — reopening a thread is supported, so the editor won't error when restoring a session.

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
- The editor spawns the agent in your **project directory**, so project-level config and relative paths resolve against the open folder.

## Limitations

- **Session history is in-memory.** Reopening a thread within the same running agent restores its history, but after the editor (and agent process) fully restarts, a reloaded thread starts empty — it is usable, but prior messages are not replayed.
- **`ask_user` is selection-only.** ACP permission options have no text input, so the model receives whichever option you pick rather than a typed answer.
- **Images and audio are not processed.** Non-text attachments are noted to the model but not interpreted.

## Troubleshooting

**Nanocoder doesn't appear / the thread fails to start**

- Confirm `nanocoder --acp` runs from your shell. If the editor was launched from the desktop (not a terminal), it may not see your shell's `PATH` — use an absolute path to the binary, or to the Node runtime, in the `command`/`args`.
- Check the editor's agent/log output for the spawn error.

**"No provider configured" or it exits immediately**

- The open folder has no resolvable provider/model. Add an `agents.config.json` to the project (or your global config), or pass `--provider`/`--model` in `args`. See [Configuration](../configuration/index.md).

**Tagged files aren't seen by the model**

- Make sure you reference the file through the editor's own file-mention UI so it sends the file as a resource. Plain text that merely names a path is not read automatically.

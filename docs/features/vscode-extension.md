---
title: "VS Code Extension"
description: "Native sidebar chat, live diff previews, and editor integration with the VS Code extension"
sidebar_order: 8
---

# VS Code Extension

The Nanocoder VS Code extension provides a native sidebar chat powered by the Agent Client Protocol (ACP). The extension manages the Nanocoder CLI for you - open the sidebar and start chatting; there is nothing to run in a terminal.

**Key features:**

- **Native Sidebar Chat**: A webview chat that streams responses, groups each turn's thinking and tool activity into one collapsible work summary, and handles tool approvals inline.
- **Provider, Model & Mode Switching**: Change your model from the picker under the composer, or your provider and operating mode from the Configuration popover beside it. Switching provider refreshes the model list automatically.
- **Settings Tab**: Configure providers and assistant behaviour from the sidebar instead of editing `agents.config.json` by hand.
- **Context Attachments**: Attach files and folders with `@` mention autocomplete, drag-and-drop, or the `+` menu. Images can be uploaded or pasted for multimodal messages.
- **Changed Files in Context**: Files the agent creates or edits appear as chips above the composer as soon as each edit lands - click one to open the current version in the editor. A file it deletes drops off the row, and a rename follows the file to its new path.
- **Code Lenses**: `Explain Code` and `Generate Tests` links above every function, method, constructor and class.
- **Sessions**: Start a new chat, browse previous sessions, and resume, rename or delete them - conversations persist to disk across restarts.
- **Slash Commands**: `/help`, `/clear`, `/copy`, the `/test`, `/explain` and `/doc` prompt templates, and your custom commands from `.nanocoder/commands` work directly in the chat. Typing `/` at the start of a line opens an autocomplete menu.
- **Copy & Retry**: Each assistant response has copy and retry buttons, and a keybinding grabs the last code block.
- **Live Subagent Progress**: Delegated agent runs show live token usage and tool activity on their card while they work.
- **Agent Action List**: Tool calls are announced before the batch runs, so you can see queued work rather than only what has finished.
- **Task Checklist**: When the AI plans work with the task tool, a live checklist card shows each task's status and overall progress.
- **Cancellation**: The Stop button or the Escape key ends the whole turn - the current tool is aborted and any queued tools are skipped.
- **Configuration Management**: The `Nanocoder: Open Configuration` command opens your `agents.config.json`.
- **Legacy Companion Mode**: The original WebSocket companion for terminal CLI sessions is still available, now opt-in.

## Installation

### Automatic Installation (Recommended)

Run Nanocoder with the `--vscode` flag and it will prompt you to install the bundled extension:

```bash
nanocoder --vscode
```

### Manual Installation

1. **Locate the VSIX file**: After installing Nanocoder, the extension is bundled at:

   - **npm global install**: `$(npm root -g)/@nanocollective/nanocoder/assets/nanocoder-vscode.vsix`
   - **From source**: `./assets/nanocoder-vscode.vsix`

2. **Install via VS Code CLI**:

   ```bash
   code --install-extension /path/to/nanocoder-vscode.vsix
   ```

3. **Or install via VS Code UI**:

   - Open VS Code
   - Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "Extensions: Install from VSIX..."
   - Select the `nanocoder-vscode.vsix` file

4. **Restart VS Code** after installation

## Using the Sidebar Chat

1. **Open the chat**: Click the Nanocoder icon in the Activity Bar. The extension spawns `nanocoder --acp` in the background and connects automatically - your project's `agents.config.json` (or your global config) is picked up as usual.

2. **Chat**: Responses stream in as they generate. Everything the agent does to answer - its thoughts, tool calls, edit cards and task plan - is collected, in order, into one collapsible work summary per turn. The reply text stays outside it, so the answer is never hidden. The header reads "Working..." while the turn runs, then "Worked for", "Stopped after" or "Failed after" plus the duration, and the summary folds away when the turn ends (unless you opened or closed it yourself). It reopens automatically when a tool inside it needs your approval.

3. **Tool activity**: Inside the work summary, consecutive tool calls group into an activity card; file edits get their own card - click it to open the change in VS Code's diff viewer.

   Each file the agent finishes writing is also added to the context row above the composer, so the work of a turn is one click away from review. Those chips are dashed to set them apart from the files you attached yourself: clicking one opens the file as it stands now, the x dismisses it, and - unlike your own attachments - they are not sent along with your next message and are not cleared when you send it. Starting or resuming a conversation clears them.

   The row follows the rest of the file lifecycle too: deleting a file takes its chip away (including one you attached yourself, which would otherwise expand to nothing on your next message), and renaming one moves its chip to the new path. Only calls that actually completed count - a delete you denied leaves the row exactly as it was.

   A turn that touches many files fills the row rather than growing the composer: it scrolls once it is a few lines deep, and a **Clear N changed files** control below it dismisses the whole run at once. That control only clears what the agent changed - files you attached stay until you remove them yourself.

4. **Approvals**: In modes that require confirmation, tool cards show Approve / Deny buttons inline. When the AI asks you a question (the `ask_user` tool), the full question is shown with one button per answer.

5. **Stop**: The send button becomes a stop button while a turn is running. Pressing it - or pressing **Escape** anywhere in the chat panel - cancels the current tool, skips any queued tools, and ends the turn. No further requests are made until you send another message.

### Provider, Model, and Mode

The model picker sits on the composer's bottom row and shows the current model. Next to it, the sliders button opens a **Configuration** popover with the **Provider** and **Mode** selectors; the mode selector shows the current mode (Normal, Auto-Accept, YOLO or Plan). Providers and models come from your `agents.config.json`; switching provider refreshes the model list (and reconciles the model if the current one isn't available on the new provider). Mode and model choices persist to VS Code settings.

### Settings Tab

The gear icon in the view title bar opens a Settings tab in the sidebar, so you can configure Nanocoder without hand-editing JSON. It reads and writes the same files as the CLI, resolved the same way (project-level `agents.config.json` and `nanocoder-preferences.json` first, then your global config directory).

The tab covers:

- **Providers** - the configured providers, their base URLs and model lists. API keys are masked; the tab only shows whether a key is set.
- **MCP servers** - each server's name and transport, plus its command or URL.
- **Tool auto-approval** - the always-allow list.
- **Default mode** - the mode new sessions start in.
- **Auto-compact** - whether it's enabled, its threshold, and its mode.
- **Reasoning traces** - whether thinking is expanded by default.
- **Sessions** - autosave on or off.
- **Token usage** - whether token and cost footers show below responses (off by default).
- **Web search** - whether it's configured.

For anything the tab doesn't cover, `Nanocoder: Open Configuration` opens the raw `agents.config.json`.

### Attaching Context

There are three ways to attach files, folders and images to a message:

- **`@` mentions**: type `@` in the composer to open a dropdown of workspace files, folders, and open editors, filtered as you type. Selecting one attaches it as a context chip. The list is capped at 30 results.
- **Drag-and-drop**: drag files or folders from the Explorer straight onto the composer.
- **The `+` menu**: all upload actions live under a single `+` button next to the composer.

Attached files are read with a cap of 100 KB each; attached folders list up to 200 entries. Binary files are detected and skipped.

Images can be uploaded through the `+` menu or pasted directly into the composer, and are sent to the model as a multimodal message. Your provider and model must support image input.

### Code Lenses

Every function, method, constructor and class in an open editor carries `Explain Code` and `Generate Tests` lenses. Clicking one reveals the Nanocoder chat view and sends a prompt with that symbol's source inlined.

Turn them off with the `nanocoder.codeLens` setting.

### Slash Commands

Typing `/` at the start of a line opens an autocomplete menu of `/test`, `/explain`, `/doc`, `/clear` and `/copy`, filtered as you type. `/` elsewhere in a line (a URL, a path in prose) does not open it. Other commands, including custom ones, are typed in full.

- `/test`, `/explain`, `/doc` - prompt templates: selecting one drops editable text (e.g. "Write tests for the following:") into the composer for you to finish and send. Nothing hidden is attached
- `/help` - list available commands, including your custom commands
- `/clear` - clear the conversation (both the visible transcript and the model's context)
- `/copy` - copy the whole previous assistant response to the clipboard
- `/copy code` - copy just the last fenced code block from the previous response
- Custom commands from `.nanocoder/commands` run as they do in the CLI
- `/model` and `/provider` point you to the model and provider selectors
- `/settings` points you to the Settings tab
- Interactive CLI-only commands (`/init`, `/theme`, `/compact`, `/context-max`, `/usage`) explain that they need the terminal CLI
- Messages that start with a file path (e.g. `/Users/me/file.ts`) are sent to the AI as normal text, not treated as commands

### Copying and Retrying Responses

- Each assistant response has a clipboard button in its footer that copies the response's raw markdown. User messages have no copy button.
- The retry button next to it sends the same prompt again: the old response is removed from the chat and the conversation is truncated back to that prompt, so the model does not see the discarded answer. Retry is unavailable while a turn is running.
- `Cmd+Alt+Shift+C` (`Ctrl+Alt+Shift+C` on Windows/Linux) copies the last code block from the previous assistant response, the same as typing `/copy code`.

### Sessions

- **New Chat**: the `+` icon in the view title bar starts a fresh conversation.
- **History**: the clock icon lists previous sessions (persisted to disk, newest first). Click a session to resume it - the full thread replays, including thinking sections and completed tool cards - or use the trash icon to delete it.
- **Rename**: sessions can be renamed from the History view. Names must be 100 characters or less. A manually set name is preserved when the session is reopened, including from the terminal CLI, and is never overwritten by an auto-generated title.
- Switching to another sidebar view (Explorer, Search, ...) and back keeps your transcript intact.

### Agent Actions

Every tool call in a turn is announced before the batch runs, so the chat shows the agent's queued work rather than only what it has already finished. Each entry moves through queued, then running, then done.

A new tool call always starts a fresh card when something else - a thought, reply text, an edit card, or a plan update - came in between, so unrelated calls don't get folded into an earlier card. Cards don't collapse individually; collapsing is done on the turn's work summary.

### Thoughts

Streamed reasoning appears inside the turn's work summary as "Thought" entries, in order with the tool calls around it. Each uninterrupted stretch of thinking is one entry; when the model goes back to thinking after a tool call, a new entry starts below it.

### Subagent Progress

When the AI delegates to a subagent, the agent's tool card updates live with the subagent's name, token usage, tool count, and the last tool it used.

### Task Checklist

When the AI organizes work with the task tool (`write_tasks`), a Tasks card appears in that turn's work summary showing each task with its status - open circle for pending, arrow for in progress, check for completed - plus a progress count in the header. The card updates in place as the AI works through the list.

## Configuration

The extension can be configured in VS Code settings (`Cmd+,` / `Ctrl+,`):

| Setting                     | Default       | Description                                                          |
| --------------------------- | ------------- | -------------------------------------------------------------------- |
| `nanocoder.cliPath`         | (empty)       | Absolute path to the nanocoder CLI. If empty, uses the global install |
| `nanocoder.cwd`             | (empty)       | Working directory for the CLI. Defaults to the workspace root         |
| `nanocoder.mode`            | `auto-accept` | Operating mode for the assistant                                      |
| `nanocoder.model`           | (empty)       | Model for Nanocoder sessions (set via the model dropdown)             |
| `nanocoder.showDiffPreview` | `true`        | Show diff preview before applying file changes                        |
| `nanocoder.codeLens`        | `true`        | Show `Explain Code` / `Generate Tests` lenses above symbols            |
| `nanocoder.autoConnect`     | `false`       | Auto-connect the legacy WebSocket companion on startup                |
| `nanocoder.autoStartCli`    | `false`       | Auto-start the CLI for companion mode if not running                  |
| `nanocoder.showTokenUsage`  | `false`       | Show token usage and estimated cost below chat responses (hidden by default; also a toggle in the Settings tab) |
| `nanocoder.serverPort`      | `51820`       | Legacy companion port, used only as a fallback when the discovery file is missing or stale |
| `nanocoder.serverToken`     | (empty)       | Legacy companion bearer token, for when the discovery file is unreachable (e.g. SSH) |

## Commands

Access these commands via the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command                                | Description                                                |
| -------------------------------------- | ---------------------------------------------------------- |
| `Nanocoder: New Chat`                  | Start a fresh conversation (also the `+` view title icon)  |
| `Nanocoder: View Session History`      | Toggle the session history list (also the clock icon)      |
| `Nanocoder: Settings`                  | Toggle the Settings tab (also the gear view title icon)    |
| `Nanocoder: Cancel Current Response`   | Cancel the in-flight turn (also the Escape key)            |
| `Nanocoder: Copy Last Code Block`      | Copy the last code block from the previous response        |
| `Nanocoder: Open Configuration`        | Open the active `agents.config.json`                       |
| `Nanocoder: Connect to Nanocoder`      | Connect the legacy companion to a running terminal CLI     |
| `Nanocoder: Disconnect from Nanocoder` | Disconnect the legacy companion                            |
| `Nanocoder: Start Nanocoder CLI`       | Open a terminal and start `nanocoder --vscode` (companion) |

`Explain Code` and `Generate Tests` are also contributed commands, but they are hidden from the Command Palette because they only make sense from a code lens.

## Keyboard Shortcuts

| Action                     | macOS             | Windows / Linux    |
| -------------------------- | ----------------- | ------------------ |
| Cancel the current turn    | `Escape`          | `Escape`           |
| Copy the last code block   | `Cmd+Alt+Shift+C` | `Ctrl+Alt+Shift+C` |

## Legacy Companion Mode

Before the sidebar chat, the extension paired with a Nanocoder session running in a terminal (`nanocoder --vscode`, or `/ide` from within a session) over a local WebSocket. That mode is still available - it is now opt-in via `nanocoder.autoConnect` - and is useful if you prefer the terminal TUI:

- **Diff previews**: file changes proposed in the terminal session open automatically in VS Code's diff viewer (controlled by `nanocoder.showDiffPreview`); you approve or reject in the CLI.
- **Active editor context**: the file you focus - and any selected lines - appears as a `⊡ In App.tsx` pill on the status line under the terminal input and is attached to your next message. Dismiss it with `/clear`, double-`Esc` at the empty input, or by focusing a non-file tab.
- **Diagnostics sharing**: LSP errors and warnings are shared with the CLI for context.
- **Status bar**: `$(plug) Nanocoder` (click to connect), `$(check) Nanocoder` (connected), `$(sync~spin) Connecting...`.

The sidebar chat and companion mode are separate conversations - the GUI does not see what a terminal session is doing.

### Companion Connection

By default `nanocoder --vscode` binds an ephemeral loopback port (pass `--vscode-port <port>` to request a fixed one) and generates a random per-session token. It writes both to a discovery file, `vscode-server.json` in your Nanocoder config directory (e.g. `~/.config/nanocoder/vscode-server.json` on Linux, `~/Library/Preferences/nanocoder/vscode-server.json` on macOS, or under `NANOCODER_CONFIG_DIR` if set). The extension reads that file and sends the token as a bearer header; a file left behind by a CLI that is no longer running is ignored.

If the discovery file isn't readable from VS Code - for example when the CLI runs on a remote host over SSH with the port forwarded - copy the `port` and `token` values from that file on the CLI's host into `nanocoder.serverPort` and `nanocoder.serverToken`. The CLI does not print the token to its logs.

## Troubleshooting

**Sidebar chat won't connect?**

- Check the Nanocoder output channel (`View > Output > Nanocoder`) - the ACP handshake, CLI discovery, and any `[CLI stderr]` errors are logged there, and the crash dialog includes the last error line.
- Ensure the `nanocoder` CLI is installed and on your PATH (or set `nanocoder.cliPath`). If `cliPath` points to a missing file, the extension logs a warning and falls back to normal discovery.
- The extension resolves your login shell's PATH before spawning, so version managers like nvm work even when VS Code is launched from the Dock. If the CLI crashes at startup, check that `node --version` in a terminal meets the minimum required by Nanocoder.

**Companion mode not connecting?**

- Ensure Nanocoder is running with the `--vscode` flag in a terminal
- Check that `vscode-server.json` exists in your Nanocoder config directory and was written by the running CLI (restart the CLI to rewrite it)
- For SSH or other remote setups, set `nanocoder.serverPort` and `nanocoder.serverToken` from that file and make sure the port is forwarded
- Click the status bar item to reconnect after restarting the CLI

**Diff not showing?**

- For GUI edits, click the file's edit card in the chat to open the diff
- For companion mode, check `nanocoder.showDiffPreview` is enabled and the status bar shows connected

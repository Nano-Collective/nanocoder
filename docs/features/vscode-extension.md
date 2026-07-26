---
title: "VS Code Extension"
description: "Native sidebar chat, live diff previews, and editor integration with the VS Code extension"
sidebar_order: 8
---

# VS Code Extension

The Nanocoder VS Code extension provides a native sidebar chat powered by the Agent Client Protocol (ACP). The extension manages the Nanocoder CLI for you - open the sidebar and start chatting; there is nothing to run in a terminal.

**Key features:**

- **Native Sidebar Chat**: A webview chat that streams responses, shows collapsible thinking sections, renders tool activity as live cards, and handles tool approvals inline.
- **Provider, Model & Mode Switching**: Change your LLM provider, model, or operating mode on the fly from the dropdowns in the chat header. Switching provider refreshes the model list automatically.
- **Sessions**: Start a new chat, browse previous sessions, and resume or delete them - conversations persist to disk across restarts.
- **Slash Commands**: `/help`, `/clear`, and your custom commands from `.nanocoder/commands` work directly in the chat.
- **Live Subagent Progress**: Delegated agent runs show live token usage and tool activity on their card while they work.
- **Cancellation**: The Stop button ends the whole turn - the current tool is aborted and any queued tools are skipped.
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

2. **Chat**: Responses stream in as they generate. Thinking appears in a collapsible "Thinking..." section that folds away when the answer starts.

3. **Tool activity**: Read-only tools group into an activity card; file edits get their own card - click it to open the change in VS Code's diff viewer.

4. **Approvals**: In modes that require confirmation, tool cards show Approve / Deny buttons inline. When the AI asks you a question (the `ask_user` tool), the full question is shown with one button per answer.

5. **Stop**: The send button becomes a stop button while a turn is running. Pressing it cancels the current tool, skips any queued tools, and ends the turn - no further requests are made until you send another message.

### Provider, Model, and Mode

The three dropdowns in the chat header switch the session's provider, model, and operating mode. Providers and models come from your `agents.config.json`; switching provider refreshes the model list (and reconciles the model if the current one isn't available on the new provider). Mode and model choices persist to VS Code settings.

### Slash Commands

- `/help` - list available commands, including your custom commands
- `/clear` - clear the conversation (both the visible transcript and the model's context)
- Custom commands from `.nanocoder/commands` run as they do in the CLI
- `/model` and `/provider` point you to the header dropdowns
- Interactive CLI-only commands (`/init`, `/theme`, `/compact`, `/context-max`, `/usage`, `/settings`) explain that they need the terminal CLI
- Messages that start with a file path (e.g. `/Users/me/file.ts`) are sent to the AI as normal text, not treated as commands

### Sessions

- **New Chat**: the `+` icon in the view title bar starts a fresh conversation.
- **History**: the clock icon lists previous sessions (persisted to disk, newest first). Click a session to resume it - the full thread replays, including thinking sections and completed tool cards - or use the trash icon to delete it.
- Switching to another sidebar view (Explorer, Search, ...) and back keeps your transcript intact.

### Subagent Progress

When the AI delegates to a subagent, the agent's tool card updates live with the subagent's name, token usage, tool count, and the last tool it used.

## Configuration

The extension can be configured in VS Code settings (`Cmd+,` / `Ctrl+,`):

| Setting                     | Default       | Description                                                          |
| --------------------------- | ------------- | -------------------------------------------------------------------- |
| `nanocoder.cliPath`         | (empty)       | Absolute path to the nanocoder CLI. If empty, uses the global install |
| `nanocoder.cwd`             | (empty)       | Working directory for the CLI. Defaults to the workspace root         |
| `nanocoder.mode`            | `auto-accept` | Operating mode for the assistant                                      |
| `nanocoder.model`           | (empty)       | Model for Nanocoder sessions (set via the model dropdown)             |
| `nanocoder.showDiffPreview` | `true`        | Show diff preview before applying file changes                        |
| `nanocoder.autoConnect`     | `false`       | Auto-connect the legacy WebSocket companion on startup                |
| `nanocoder.autoStartCli`    | `false`       | Auto-start the CLI for companion mode if not running                  |
| `nanocoder.serverPort`      | `51820`       | WebSocket port for the legacy companion mode                          |

## Commands

Access these commands via the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command                                | Description                                                |
| -------------------------------------- | ---------------------------------------------------------- |
| `Nanocoder: New Chat`                  | Start a fresh conversation (also the `+` view title icon)  |
| `Nanocoder: View Session History`      | Toggle the session history list (also the clock icon)      |
| `Nanocoder: Open Configuration`        | Open the active `agents.config.json`                       |
| `Nanocoder: Connect to Nanocoder`      | Connect the legacy companion to a running terminal CLI     |
| `Nanocoder: Disconnect from Nanocoder` | Disconnect the legacy companion                            |
| `Nanocoder: Start Nanocoder CLI`       | Open a terminal and start `nanocoder --vscode` (companion) |

## Legacy Companion Mode

Before the sidebar chat, the extension paired with a Nanocoder session running in a terminal (`nanocoder --vscode`, or `/ide` from within a session) over a local WebSocket. That mode is still available - it is now opt-in via `nanocoder.autoConnect` - and is useful if you prefer the terminal TUI:

- **Diff previews**: file changes proposed in the terminal session open automatically in VS Code's diff viewer (controlled by `nanocoder.showDiffPreview`); you approve or reject in the CLI.
- **Active editor context**: the file you focus - and any selected lines - appears as a `⊡ In App.tsx` pill on the status line under the terminal input and is attached to your next message. Dismiss it with `/clear`, double-`Esc` at the empty input, or by focusing a non-file tab.
- **Diagnostics sharing**: LSP errors and warnings are shared with the CLI for context.
- **Status bar**: `$(plug) Nanocoder` (click to connect), `$(check) Nanocoder` (connected), `$(sync~spin) Connecting...`.

The sidebar chat and companion mode are separate conversations - the GUI does not see what a terminal session is doing.

## Troubleshooting

**Sidebar chat won't connect?**

- Check the Nanocoder output channel (`View > Output > Nanocoder`) - the ACP handshake, CLI discovery, and any `[CLI stderr]` errors are logged there, and the crash dialog includes the last error line.
- Ensure the `nanocoder` CLI is installed and on your PATH (or set `nanocoder.cliPath`). If `cliPath` points to a missing file, the extension logs a warning and falls back to normal discovery.
- The extension resolves your login shell's PATH before spawning, so version managers like nvm work even when VS Code is launched from the Dock. If the CLI crashes at startup, check that `node --version` in a terminal meets the minimum required by Nanocoder.

**Companion mode not connecting?**

- Ensure Nanocoder is running with the `--vscode` flag in a terminal
- Verify port 51820 (or your `nanocoder.serverPort`) is not blocked or in use
- Click the status bar item to reconnect after restarting the CLI

**Diff not showing?**

- For GUI edits, click the file's edit card in the chat to open the diff
- For companion mode, check `nanocoder.showDiffPreview` is enabled and the status bar shows connected

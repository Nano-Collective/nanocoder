---
title: "VS Code Extension"
description: "Live diff previews and editor integration with the VS Code extension"
sidebar_order: 8
---

# VS Code Extension

The Nanocoder VS Code extension provides a fully native Sidebar Chat interface powered by the Agent Client Protocol (ACP). It seamlessly integrates your local-first AI workflow directly into your IDE.

**Key features:**

- **Native Sidebar Chat UI (New)**: A webview-based chat interface that streams responses, runs subagents, displays inline tool approvals, handles context aggregation, and provides command completion.
- **Provider & Model Switching**: Change your LLM provider or model on the fly directly from the VS Code sidebar header.
- **Live Subagent Progress**: Observe your subagents' active tasks and token usage directly inside the chat interface.
- **Configuration Management**: New `Nanocoder: Open Configuration` command to quickly access your `agents.config.json`.
- **Legacy Companion Mode**: The original WebSocket-based companion mode is now opt-in via VS Code settings. Allows diff previewing and editor context sharing from an external terminal.

## Installation

There are two ways to install the VS Code extension:

### Automatic Installation (Recommended)

When you open the Nanocoder sidebar in VS Code for the first time, it will automatically prompt you to install the extension if it is missing.

Alternatively, you can manually trigger installation via the CLI:

```bash
nanocoder --vscode
```

If the extension isn't installed, you'll see a prompt asking if you'd like to install it. Select "Yes" to install it.

### Manual Installation

If you prefer to install manually or the automatic installation doesn't work:

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

4. **Reload VS Code** after installation

## Usage

1. **Start Nanocoder with VS Code integration** using one of these methods:

   **From the CLI flag:**

   ```bash
   nanocoder --vscode
   ```

   **From within a Nanocoder session:**

   ```bash
   /ide
   ```

   This opens an interactive selector where you can choose VS Code. Nanocoder will check if the extension is installed and prompt you to install it if needed, then start the integration server.

   **From within VS Code:**

   - Press `Cmd+Shift+P` / `Ctrl+Shift+P`
   - Run "Nanocoder: Start Nanocoder CLI"

2. **The extension connects automatically** when Nanocoder starts with `--vscode` or after selecting VS Code via `/ide`

3. **View diff previews**: When Nanocoder suggests file changes, a diff view automatically opens in VS Code showing:

   - The original file content on the left
   - The proposed changes on the right
   - Syntax highlighting for the file type

4. **Approve or reject changes**: Use the Nanocoder CLI to approve or reject the changes. The diff preview is read-only and for visualization only.

5. **Active editor context**: Focus any file in VS Code and a `⊡ In <file>` pill appears on the status line under the Nanocoder input (alongside the mode and context indicators). Highlight a range of lines and the pill becomes `⊡ <file> (L<start>-<end>)`. When you submit, the pill is appended to your message so the AI knows what you're looking at.

6. **Status bar**: The Nanocoder status bar item shows connection status:
   - `$(plug) Nanocoder` - Not connected (click to connect)
   - `$(check) Nanocoder` - Connected to CLI
   - `$(sync~spin) Connecting...` - Connection in progress

## Active Editor Context

The extension continuously pushes your current editor state to the CLI so Nanocoder always knows what you're looking at:

1. **Focus any file** in VS Code — a `⊡ In App.tsx` pill appears on the status line under the Nanocoder input, inline with the mode, tune, and context indicators.
2. **Highlight lines** to switch the pill to `⊡ App.tsx (L10-25)`. The selected code is captured and inlined into your next message.
3. **Type your question** and submit. The pill is appended to your message as a highlighted placeholder (`[@App.tsx (lines 10-25)]`) and, if there's a selection, the code is sent to the AI as a hidden code block — kept out of the on-screen chat so it doesn't clutter the display.
4. **No selection?** Only the filename hint is attached. If the AI needs the full contents it can read the file itself.
5. **Dismiss the context** in three ways:
   - Run `/clear` — clears the chat and the pill together.
   - Press `Esc` twice at the empty input — same effect, without clearing the chat history.
   - Leave the file in VS Code (focus a terminal or non-file tab, or open a different file) — the pill updates or disappears automatically.

   When you dismiss via `/clear` or double-`Esc`, any new selection or file focus in VS Code brings the pill back — the dismissal only applies to the current file + line range.
6. **Long filenames** are truncated with an ellipsis so the status line always fits on one row.

## Configuration

The extension can be configured in VS Code settings (`Cmd+,` / `Ctrl+,`):

| Setting                     | Default | Description                                       |
| --------------------------- | ------- | ------------------------------------------------- |
| `nanocoder.autoConnect`     | `true`  | Automatically connect to Nanocoder CLI on startup |
| `nanocoder.serverPort`      | `51820` | Port for WebSocket communication with CLI         |
| `nanocoder.showDiffPreview` | `true`  | Automatically show diff preview for file changes  |

**Example settings.json**:

```json
{
	"nanocoder.autoConnect": true,
	"nanocoder.serverPort": 51820,
	"nanocoder.showDiffPreview": true
}
```

## Commands

Access these commands via the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command                                | Description                                  |
| -------------------------------------- | -------------------------------------------- |
| `Nanocoder: Connect to Nanocoder`      | Manually connect to running Nanocoder CLI    |
| `Nanocoder: Disconnect from Nanocoder` | Disconnect from CLI                          |
| `Nanocoder: Start Nanocoder CLI`       | Open terminal and start `nanocoder --vscode` |

## Troubleshooting

**Extension not connecting?**

- Ensure Nanocoder is running with `--vscode` flag
- Check the Nanocoder output channel in VS Code (`View > Output > Nanocoder`)
- Verify port 51820 is not blocked by a firewall

**Diff not showing?**

- Check that `nanocoder.showDiffPreview` is enabled in settings
- Ensure the extension is connected (check status bar)

**Connection drops frequently?**

- This can happen if you restart the CLI. Click the status bar to reconnect.

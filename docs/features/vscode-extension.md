---
title: "VS Code Extension"
description: "Live diff previews and editor integration with the VS Code extension"
sidebar_order: 8
---

# VS Code Extension

If you use VS Code as your editor, the Nanocoder extension bridges it with the CLI. When the AI proposes a file edit, you see a full diff preview in VS Code before approving. You can also right-click selected code to ask questions about it directly.

**Key features:**

- **Ask About Code**: Right-click selected code to ask Nanocoder questions directly from VS Code
- **Live Diff Preview**: See proposed file changes in VS Code's diff viewer before approving
- **Diagnostics Sharing**: VS Code's LSP diagnostics are shared with Nanocoder for context

## Installation

There are two ways to install the VS Code extension:

### Automatic Installation (Recommended)

When you run Nanocoder with the `--vscode` flag for the first time, it will automatically prompt you to install the extension:

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

5. **Ask about code**: Select code, right-click, and choose "Ask Nanocoder about this" to send questions about specific code to the CLI.

6. **Status bar**: The Nanocoder status bar item shows connection status:
   - `$(plug) Nanocoder` - Not connected (click to connect)
   - `$(check) Nanocoder` - Connected to CLI
   - `$(sync~spin) Connecting...` - Connection in progress

## Ask About Code

The "Ask Nanocoder about this" feature lets you quickly get help with specific code:

1. **Select code** in any file
2. **Right-click** and choose "Ask Nanocoder about this"
3. **Enter your question** in the input box that appears
4. The question and code are sent to the Nanocoder CLI
5. Nanocoder responds with full context of your selected code

In the CLI, you'll see your question with a highlighted placeholder showing the file and line range (e.g., `[@App.tsx (lines 10-25)]`). The full code is sent to the AI for analysis but kept compact in the display.

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

| Command                                | Description                                    |
| -------------------------------------- | ---------------------------------------------- |
| `Nanocoder: Connect to Nanocoder`      | Manually connect to running Nanocoder CLI      |
| `Nanocoder: Disconnect from Nanocoder` | Disconnect from CLI                            |
| `Nanocoder: Start Nanocoder CLI`       | Open terminal and start `nanocoder --vscode`   |
| `Nanocoder: Ask Nanocoder about this`  | Ask about selected code (also in context menu) |

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

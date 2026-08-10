# Nanocoder VS Code Extension

VS Code integration for [Nanocoder](https://github.com/Nano-Collective/nanocoder) - a local-first AI coding assistant.

The extension provides a native sidebar chat powered by the Agent Client Protocol (ACP). It manages the Nanocoder CLI for you - open the sidebar and start chatting; nothing needs to run in a terminal.

## Features

- **Native Sidebar Chat**: Streams responses with collapsible thinking sections, live tool-activity cards, and inline tool approvals
- **Provider, Model & Mode Switching**: Dropdowns in the chat header; switching provider refreshes the model list automatically
- **Sessions**: New Chat, session history with resume and delete, persisted to disk across restarts
- **Slash Commands**: `/help`, `/clear`, and custom commands from `.nanocoder/commands`
- **Live Subagent Progress**: Delegated agent runs show live token and tool activity on their card
- **Task Checklist**: The AI's task list renders as a live checklist card with per-task status and progress
- **Cancellation**: Stop ends the whole turn - the current tool aborts and queued tools are skipped
- **Diff Previews**: Click a file-edit card to open the change in VS Code's diff viewer
- **Legacy Companion Mode** (opt-in): Pairs with a terminal CLI session over WebSocket for diff previews and editor context

## Installation

### Automatic Installation (Recommended)

Run Nanocoder with the `--vscode` flag and it will prompt you to install the bundled extension:

```bash
nanocoder --vscode
```

### Manual Installation

#### From VSIX

After installing Nanocoder, the extension VSIX is bundled in the package:

```bash
# Find the VSIX location (npm global install)
code --install-extension $(npm root -g)/@nanocollective/nanocoder/assets/nanocoder-vscode.vsix
```

Or install via VS Code UI:

1. Open VS Code
2. Press `Ctrl+Shift+P` / `Cmd+Shift+P`
3. Type "Extensions: Install from VSIX..."
4. Select the `nanocoder-vscode.vsix` file

#### From Source

1. Navigate to the extension directory:

   ```bash
   cd plugins/vscode
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Build and package the extension:

   ```bash
   pnpm run build
   pnpm exec vsce package --allow-missing-repository --skip-license --no-dependencies
   ```

4. Install the generated `.vsix` file in VS Code

### Development

```bash
# Watch for changes (extension + Tailwind CSS)
pnpm run watch

# Build for production
pnpm run build

# Package for distribution
pnpm exec vsce package --allow-missing-repository --skip-license --no-dependencies
```

Or from the repo root: `pnpm run build:vscode` builds and packages to `assets/nanocoder-vscode.vsix`. For F5 debugging, point the Extension Development Host at the repo root - the extension picks up `dist/cli.js` from the workspace automatically.

## Usage

### Sidebar Chat

1. Click the Nanocoder icon in the Activity Bar. The extension spawns `nanocoder --acp` in the background and connects automatically - your project's `agents.config.json` (or global config) is used.
2. Chat. Responses stream in; thinking appears in a collapsible section.
3. Read-only tools group into an activity card; file edits get their own card - click it to open VS Code's diff viewer.
4. In modes that require confirmation, tool cards show Approve / Deny inline. Questions from the AI (`ask_user`) show the full question with one button per answer.
5. The send button becomes Stop while a turn runs - pressing it cancels the current tool, skips queued tools, and ends the turn.

### Sessions

- **New Chat**: the `+` icon in the view title bar
- **History**: the clock icon - resume a previous session (the full thread replays) or delete it
- Switching to another sidebar view and back keeps the transcript

### Settings

The gear icon in the view title bar opens a settings panel. It edits the default
mode and auto-compact behaviour, lists the configured providers and MCP servers,
and links to the raw config file for anything it does not cover. Saves are merged
into `agents.config.json` under the `nanocoder` key.

### Slash Commands

`/help` lists what's available. `/clear` resets the conversation. Custom commands from `.nanocoder/commands` run as in the CLI. Interactive CLI-only commands (`/init`, `/theme`, `/compact`, ...) explain that they need the terminal CLI. Messages starting with a file path are treated as text, not commands.

### Commands

Access via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command                                | Description                                               |
| -------------------------------------- | --------------------------------------------------------- |
| `Nanocoder: New Chat`                  | Start a fresh conversation (also the `+` view title icon) |
| `Nanocoder: View Session History`      | Toggle the session history list (also the clock icon)     |
| `Nanocoder: Open Settings`             | Toggle the settings panel (also the gear icon)            |
| `Nanocoder: Open Configuration`        | Open the active `agents.config.json`                      |
| `Nanocoder: Connect to Nanocoder`      | Connect the legacy companion to a running terminal CLI    |
| `Nanocoder: Disconnect from Nanocoder` | Disconnect the legacy companion                           |
| `Nanocoder: Start Nanocoder CLI`       | Open a terminal and run `nanocoder --vscode` (companion)  |

### Configuration

Configure the extension in VS Code settings (`Ctrl+,` / `Cmd+,`):

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

## Legacy Companion Mode

The original integration pairs the extension with a Nanocoder session running in a terminal (`nanocoder --vscode`) over a local WebSocket (port 51820 by default). It is opt-in via `nanocoder.autoConnect` and useful if you prefer the terminal TUI:

- Diff previews for changes proposed in the terminal session (approve/reject in the CLI)
- Active-editor context: the focused file and selection appear as a pill on the CLI status line and attach to your next message
- LSP diagnostics sharing
- Status bar item showing connection state

The sidebar chat and companion mode are separate conversations.

### Companion Protocol

The companion communicates via JSON messages over WebSocket:

| CLI → Extension       | Description                                  |
| --------------------- | -------------------------------------------- |
| `connection_ack`      | Connection acknowledgment with version info  |
| `file_change`         | Proposed file modification with diff content |
| `status`              | Current model/provider/connection status     |
| `diagnostics_request` | Request LSP diagnostics from VS Code         |

| Extension → CLI        | Description                                                         |
| ---------------------- | ------------------------------------------------------------------- |
| `context`              | Workspace info (open files, active file, diagnostics)               |
| `diagnostics_response` | LSP diagnostics data from VS Code                                   |
| `active_editor`        | Focused file + optional selection, pushed on focus/selection change |

## Troubleshooting

### Sidebar chat won't connect?

- Check the Nanocoder output channel: `View > Output > Nanocoder` - CLI discovery, the ACP handshake, and `[CLI stderr]` errors are logged there, and the crash dialog includes the last error line
- Ensure the `nanocoder` CLI is installed and on your PATH, or set `nanocoder.cliPath` (a missing path logs a warning and falls back to discovery)
- The extension resolves your login shell's PATH before spawning, so nvm-style setups work when VS Code is launched from the Dock; if the CLI still crashes at startup, check your `node --version` meets Nanocoder's minimum

### Companion mode not connecting?

- Ensure Nanocoder is running with the `--vscode` flag
- Verify port 51820 (or `nanocoder.serverPort`) is not blocked or in use
- Click the status bar item to reconnect after restarting the CLI

## License

MIT - See the main [Nanocoder repository](https://github.com/Nano-Collective/nanocoder) for details.

---
title: "Uninstalling"
description: "How to uninstall Nanocoder and clean up configuration files"
sidebar_order: 3
---

# Uninstalling Nanocoder

## Finding Your Installation

If you're unsure how Nanocoder was installed, find the binary location first:

```bash
which nanocoder
```

This will show the path — for example:
- `/usr/local/bin/nanocoder` or `/usr/local/lib/node_modules/...` → npm
- `.../Cellar/nanocoder/...` (check with `brew list nanocoder`) → Homebrew
- `/nix/store/...` → Nix

A path under `/opt/homebrew/bin/` on its own does not mean Homebrew installed Nanocoder: an `npm install -g` using Homebrew's Node also puts the binary there. If `brew list nanocoder` reports nothing, it was installed with npm.

## Before You Uninstall: Stop the Daemon

If you installed the [skill daemon](../features/skills.md#the-daemon) as a login service, remove it first in each project where you ran `nanocoder daemon install`. Otherwise the LaunchAgent (macOS) or systemd user unit (Linux) is left behind, pointing at a binary that no longer exists:

```bash
nanocoder daemon stop
nanocoder daemon uninstall
```

## NPM

```bash
npm uninstall -g @nanocollective/nanocoder
```

## Homebrew

```bash
brew uninstall nanocoder
# Optionally remove the tap as well
brew untap nano-collective/nanocoder
```

## Nix

If installed via `nix run`, no uninstall is needed. If added to your system packages, remove it from your `configuration.nix` or `flake.nix` and rebuild.

## Troubleshooting

If `nanocoder` still works after uninstalling, your shell may have cached the old path. Restart your terminal or run:

```bash
hash -r
```

If it persists, you may have multiple installations. Run `which nanocoder` again to find the remaining one and uninstall using the appropriate method above.

## Removing Configuration and Data

Nanocoder keeps three kinds of files outside your projects. Remove whichever you no longer want.

**Configuration** (`agents.config.json`, `nanocoder-preferences.json`, personal commands, tools, agents and skills, provider login credentials):

```bash
# macOS
rm -rf ~/Library/Preferences/nanocoder/

# Linux ($XDG_CONFIG_HOME/nanocoder if XDG_CONFIG_HOME is set)
rm -rf ~/.config/nanocoder/

# Windows (PowerShell)
Remove-Item -Recurse -Force "$env:APPDATA\nanocoder"
```

**Application data** (saved sessions, semantic memory, usage and stats, task and plan artifacts):

```bash
# macOS
rm -rf ~/Library/Application\ Support/nanocoder/

# Linux
rm -rf ~/.local/share/nanocoder/

# Windows: same folder as the configuration above ("$env:APPDATA\nanocoder")
```

If `XDG_DATA_HOME` is set, data lives in `$XDG_DATA_HOME/nanocoder` on every platform.

**Logs:**

```bash
# macOS
rm -rf ~/Library/Logs/nanocoder/

# Linux ($XDG_STATE_HOME/nanocoder/logs if XDG_STATE_HOME is set)
rm -rf ~/.local/state/nanocoder/logs/

# Windows (PowerShell)
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\nanocoder\logs"
```

If you set `NANOCODER_CONFIG_DIR`, `NANOCODER_DATA_DIR` or `NANOCODER_LOG_DIR`, remove those directories instead of the defaults above.

**Per-project files** (in each project directory):

```bash
rm -rf .nanocoder/   # project commands, tools, agents, skills, checkpoints
```

A project may also contain `agents.config.json`, `nanocoder-preferences.json` and `.mcp.json`. Check before deleting them: they are often committed to the repository, and `.mcp.json` is a shared convention that other tools (such as Claude Code) also read, so removing it can break those tools.

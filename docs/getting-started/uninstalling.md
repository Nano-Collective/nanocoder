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
- `/opt/homebrew/bin/nanocoder` or `.../Cellar/...` → Homebrew
- `/nix/store/...` → Nix

## NPM

```bash
npm uninstall -g @nanocollective/nanocoder
```

## Homebrew

```bash
brew uninstall nanocoder
```

## Nix

If installed via `nix run`, no uninstall is needed. If added to your system packages, remove it from your `configuration.nix` or `flake.nix` and rebuild.

## Troubleshooting

If `nanocoder` still works after uninstalling, your shell may have cached the old path. Restart your terminal or run:

```bash
hash -r
```

If it persists, you may have multiple installations. Run `which nanocoder` again to find the remaining one and uninstall using the appropriate method above.

## Removing Configuration Files

To also remove Nanocoder's configuration and preferences:

```bash
# macOS
rm -rf ~/Library/Preferences/nanocoder/

# Linux
rm -rf ~/.config/nanocoder/

# Per-project config (in each project directory)
rm -f .mcp.json
rm -rf .nanocoder/
```

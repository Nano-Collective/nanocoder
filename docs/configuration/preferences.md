---
title: "Preferences"
description: "User preferences and application data directory configuration"
sidebar_order: 4
---

# User Preferences

Nanocoder automatically saves your preferences to remember your choices across sessions.

## Preferences File Locations

Preferences follow the same location hierarchy as configuration files:

1. **Project-level**: `nanocoder-preferences.json` in your current working directory (overrides user-level)
2. **User-level**: Platform-specific application data directory:
   - **macOS**: `~/Library/Preferences/nanocoder/nanocoder-preferences.json`
   - **Linux/Unix**: `~/.config/nanocoder/nanocoder-preferences.json`
   - **Windows**: `%APPDATA%\nanocoder\nanocoder-preferences.json`
3. **Legacy**: `~/.nanocoder-preferences.json` (backward compatibility)

## What Gets Saved Automatically

- **Last provider used**: The AI provider you last selected (by name from your configuration)
- **Last model per provider**: Your preferred model for each provider
- **Session continuity**: Automatically switches back to your preferred provider/model when restarting
- **Last theme used**: The theme you last selected

## Manual Management

- View current preferences: The file is human-readable JSON
- Reset preferences: Delete any `nanocoder-preferences.json` to start fresh

## Application Data Directory

Nanocoder stores internal application data (such as usage statistics) in a separate application data directory:

- **macOS**: `~/Library/Application Support/nanocoder`
- **Linux/Unix**: `$XDG_DATA_HOME/nanocoder` or `~/.local/share/nanocoder`
- **Windows**: `%APPDATA%\nanocoder`

You can override this directory using `NANOCODER_DATA_DIR`.

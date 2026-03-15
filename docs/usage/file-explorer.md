---
title: "File Explorer"
description: "Interactive file browser for navigating and selecting files as context"
sidebar_order: 3
---

# File Explorer

The `/explorer` command opens an interactive file browser for navigating your project, previewing files with syntax highlighting, and selecting multiple files to add as context.

## Navigation

| Key | Action |
|-----|--------|
| Up/Down | Navigate through files and directories |
| Enter | Expand/collapse directory or preview file |
| Space | Toggle file/directory selection |
| / | Enter search mode (filters all files including nested) |
| Backspace | Collapse current directory |
| Esc | Exit explorer (selected files are added to input) |

## Features

- **Tree view**: Browse your project structure with expandable directories
- **File preview**: View file contents with syntax highlighting before selecting
- **Compressed indentation**: Preview displays content with compressed indentation (tabs/4-spaces become 2-spaces) for narrow terminals
- **Multi-select**: Select multiple files to add as context at once
- **Directory selection**: Press Space on a directory to select all files within it
- **Search**: Press `/` to filter files by name across the entire tree
- **Token estimation**: Shows estimated token count for selected files with warning for large selections (10k+ tokens)
- **VS Code integration**: When running with `--vscode`, previewing a file also opens it in VS Code for full-featured viewing

## Selection Indicators

- `✓` - File or directory fully selected
- `◐` - Directory partially selected (some files within)
- `✗` - File not selected (in preview mode)
- `v` / `>` - Directory expanded / collapsed

## Example Workflow

```bash
# Open the file explorer
/explorer

# Navigate to src/components, expand it
# Select multiple component files with Space
# Press Esc to add them to your input as @file mentions
```

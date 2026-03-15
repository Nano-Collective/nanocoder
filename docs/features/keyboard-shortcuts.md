---
title: "Keyboard Shortcuts"
description: "Keyboard shortcuts reference for Nanocoder"
sidebar_order: 11
---

# Keyboard Shortcuts

## Submitting & Multi-line Input

| Action | Shortcut | Notes |
|--------|----------|-------|
| Submit prompt | Enter | |
| New line | Ctrl+J | Most reliable across terminals |
| New line | Shift+Enter | Terminal-dependent |
| New line | Option/Alt+Enter | VS Code integrated terminal |

> **Note on multi-line input**: Terminal support for Shift+Enter / Option/Alt+Enter varies across terminals and operating systems. If one doesn't work, use Ctrl+J — it sends a literal newline character and works reliably everywhere.

## Cursor Movement

| Action | Shortcut |
|--------|----------|
| Move cursor left | Left Arrow |
| Move cursor right | Right Arrow |
| Move cursor to start of line | Ctrl+A |
| Move cursor to end of line | Ctrl+E |
| Move cursor back one character | Ctrl+B |
| Move cursor forward one character | Ctrl+F |

## Text Editing

| Action | Shortcut |
|--------|----------|
| Delete character before cursor | Backspace |
| Delete character at cursor | Delete |
| Delete previous word | Ctrl+W |
| Delete from cursor to start of line | Ctrl+U |
| Delete from cursor to end of line | Ctrl+K |
| Clear input | Esc (twice) |

## Autocomplete

| Action | Shortcut |
|--------|----------|
| Accept file/command suggestion | Tab |
| Navigate file suggestions | Up/Down |
| Exit file autocomplete | Space |

When typing `@` for file mentions or `/` for commands, Tab accepts the current suggestion. If there are multiple matches, Tab shows the completion list.

## History & Navigation

| Action | Shortcut |
|--------|----------|
| Previous prompt | Up |
| Next prompt | Down |

## During AI Response

| Action | Shortcut |
|--------|----------|
| Cancel response | Esc |

## Display

| Action | Shortcut |
|--------|----------|
| Toggle development mode | Shift+Tab |
| Toggle compact tool output | Ctrl+O |

---
title: "Keyboard Shortcuts"
description: "Keyboard shortcuts reference for Nanocoder"
sidebar_order: 11
---

# Keyboard Shortcuts

This page covers the main chat input and common interactive views. Some specialised screens may show additional inline controls.

## Submitting & Multi-line Input

| Action | Shortcut | Notes |
|--------|----------|-------|
| Submit prompt | Enter | |
| New line | Ctrl+J | Official supported shortcut |
| New line fallback | Shift+Enter | Terminal-dependent fallback only |

> **Note on multi-line input**: Ctrl+J is the only officially supported newline shortcut. Some terminals also send Shift+Enter as a newline, but that behavior is terminal-dependent and should be treated as a fallback only.

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

When typing `@` for file mentions or `/` for commands, Tab accepts the current suggestion. If there are multiple command matches, the first Tab shows the completion list and pressing Tab again accepts the first result.

## Image Attachments

| Action | Shortcut |
|--------|----------|
| Paste image from clipboard | Ctrl+V |
| Remove last attached image | Ctrl+X |

Ctrl+V pulls an image off the system clipboard and adds it as an attachment. You can also attach an image by typing, pasting, or dragging an image file path into the input — quoted, unquoted, and macOS backslash-escaped paths (e.g. `Screenshot\ 2026.png`) are all recognised. Attachments appear above the input box as `[image #1: …]`; Ctrl+X drops the most recently added one. See [Image Attachments](image-attachments.md) for the full feature, including supported formats and platform requirements.

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
| Toggle expanded reasoning traces | Ctrl+R |

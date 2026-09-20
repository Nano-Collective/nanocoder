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

## Copying & Pasting Text

| Action | Shortcut |
|--------|----------|
| Paste text | Your terminal's own paste (Cmd+V on macOS, usually Ctrl+Shift+V on Linux) |
| Copy last response to clipboard | `/copy` |
| Toggle selection mode (fullscreen only) | Ctrl+P |

Nanocoder enables **bracketed paste**, so the terminal hands over a pasted block in one piece rather than as a stream of keystrokes. Multi-line pastes no longer submit the prompt at the first line break. Pastes that are multi-line, or longer than the paste threshold, collapse into a `[Paste #1: 1234 chars]` placeholder to keep the input readable; the full text is still sent with your message. Adjust the threshold under `/settings`.

Note that Ctrl+V is bound to *image* paste, not text. Use your terminal's paste shortcut for text.

**Selection mode** applies to fullscreen mode only. Fullscreen turns on mouse reporting so the wheel can scroll the chat viewport, and that takes click-drag selection away from the terminal. Ctrl+P suspends mouse reporting so you can select and copy with the mouse as normal; press it again to resume scrolling. Inline mode (the default) never enables mouse reporting, so selection works there without doing anything and Ctrl+P does nothing.

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
| Toggle selection mode (fullscreen only) | Ctrl+P |

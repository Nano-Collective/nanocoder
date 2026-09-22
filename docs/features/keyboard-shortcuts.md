---
title: "Keyboard Shortcuts"
description: "Keyboard shortcuts reference for Nanocoder"
sidebar_order: 11
---

# Keyboard Shortcuts

This page covers the main chat input and common interactive views. Some specialised screens may show additional inline controls.

Press `?` in an empty prompt to open an in-app overlay listing the main shortcuts; press `?` or Esc to close it.

## Submitting & Multi-line Input

| Action | Shortcut | Notes |
|--------|----------|-------|
| Submit prompt | Enter | |
| New line | Ctrl+J | Works in every terminal |
| New line | Option+Enter (macOS) / Alt+Enter | Sends ESC+CR, which most terminals emit natively |
| New line | Shift+Enter | Only in terminals that encode it distinctly; see below |

**Why Shift+Enter is terminal-dependent.** Most terminals send Shift+Enter as a bare carriage return, byte-identical to plain Enter, so no application can tell the two apart. Nanocoder recognises every encoding that *is* distinguishable: a literal line feed (Ctrl+J), ESC+CR (Option/Alt+Enter), the kitty keyboard protocol's `CSI 13;2u`, and xterm's modifyOtherKeys form `CSI 27;2;13~`, which the VS Code integrated terminal can be configured to send.

If Shift+Enter submits instead of adding a line, bind it in your terminal to send a line feed. In VS Code, add this to `keybindings.json`:

```json
{
  "key": "shift+enter",
  "command": "workbench.action.terminal.sendSequence",
  "args": { "text": "\n" },
  "when": "terminalFocus"
}
```

Take care to send a bare `\n`. A sequence such as `"\\\r\n"` sends a literal backslash followed by the newline, leaving a stray `\` in the prompt on every press.

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
| Accept file/command suggestion, or insert the suggested next command in an empty prompt | Tab |
| Navigate file suggestions | Up/Down |
| Exit file autocomplete | Space |
| Dismiss the suggested next command | Esc (empty prompt) |

When typing `@` for file mentions or `/` for commands, Tab accepts the current suggestion. If there are multiple command matches, the first Tab shows the completion list and pressing Tab again accepts the first result.

After a turn that edits files, the empty prompt suggests a follow-up command: `/commit` when changes are already staged, otherwise `/checkpoint create`. Typing replaces the suggestion, Tab inserts it, and Esc dismisses it.

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

Nanocoder enables **bracketed paste**, so the terminal hands over a pasted block in one piece rather than as a stream of keystrokes. Multi-line pastes no longer submit the prompt at the first line break. Pastes that are multi-line, or longer than the paste threshold, collapse into a placeholder to keep the input readable (`[Paste #1: 7 lines]` for a multi-line paste, `[Paste #1: 1234 chars]` for a single long line); the full text is still sent with your message. Adjust the threshold under `/settings`.

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

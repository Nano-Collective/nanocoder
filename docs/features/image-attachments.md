---
title: "Image Attachments"
description: "Attach screenshots and images to your messages so vision-capable models can see them"
sidebar_order: 12
---

# Image Attachments

Nanocoder can send images alongside your text so a vision-capable model can look at a screenshot, a diagram, or a design mockup. Attachments are gathered as you compose a message and sent with the next prompt you submit.

## Attaching an Image

There are three ways to attach an image:

| Method | How |
|--------|-----|
| Clipboard paste | Copy an image, then press **Ctrl+V** in the input |
| Drag and drop | Drag an image file into the terminal |
| File path | Type or paste a path to an image file |

For drag-and-drop and typed paths, the path can be **quoted, unquoted, or backslash-escaped**. macOS terminals drop a dragged screenshot in as an unquoted path with escaped spaces (e.g. `Screenshot\ 2026-06-21\ at\ 10.04.32.png`) — that form is recognised without you needing to add quotes. The image reference is stripped from your message text before it's sent, so the model receives the picture rather than a file path.

Remote `http(s)://` URLs that end in an image extension are left as plain text — they are not fetched or treated as local files.

## Managing Attachments

Pending attachments are listed just above the input box:

```
[image #1: Screenshot 2026-06-21.png] [image #2: clipboard] · ctrl-x remove last
```

- **Ctrl+X** removes the most recently added attachment.
- Attachments are cleared once the message is submitted.

## Supported Formats

PNG, JPEG, GIF, and WebP are accepted (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`). Each image must be **10 MB or smaller**; larger files are skipped.

Whether the image is actually understood depends on the model — attach images only when your provider/model supports vision. If a model can't accept images, it will report or error on its own.

## Clipboard Requirements by Platform

Clipboard paste (**Ctrl+V**) shells out to a platform tool to read the image. If the tool isn't installed, the paste is a no-op and a one-line note is written to the debug log naming the missing command.

| Platform | Required tool |
|----------|---------------|
| macOS | `osascript` (built in) |
| Linux (Wayland) | `wl-paste` |
| Linux (X11) | `xclip` |
| Windows | PowerShell |

On a minimal Linux container without `wl-paste` or `xclip` — common in dev containers and CI — clipboard paste won't work; attach by drag-and-drop or file path instead, or install one of the tools.

## See Also

- [Keyboard Shortcuts](keyboard-shortcuts.md) — full shortcut reference, including the image bindings.

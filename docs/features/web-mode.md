---
title: "Web Mode"
description: "Use Nanocoder from a local browser alongside the terminal"
---

# Web Mode

Launch `nanocoder --web` (or `nanocoder --gui`) to open the browser interface.
For a source checkout, run `pnpm build` followed by `pnpm web`.
The terminal displays the local URL and continues to run the agent. Complete
directory trust and provider setup in the terminal if prompted.

## Browser workflow

- Chat with streaming Markdown responses, image attachments, and collapsible
  reasoning/tool summaries. Enter sends; Shift+Enter inserts a new line.
- Approve or deny tools and answer agent questions in the browser.
- Stop the current turn with the composer stop button.
- Use **New chat** and the recent-chat list to create, resume, or delete sessions.
- Open **Settings** to change provider, model, or development mode.
- Open **Tasks** to inspect the current conversation's task list.
- Open **Changes** to select a file and inspect staged/unstaged Git diffs or
  untracked text. These panels have a Refresh button.

The copy/time footer appears beneath the final assistant reply when the turn
finishes. Refreshing the page or reconnecting restores runtime history and any
pending interaction. Browser tabs share one active conversation and agent turn.

## Local transport and trust boundary

The HTTP server binds to `127.0.0.1` by default and rejects non-loopback bindings.
It generates a 32-byte random access token; both the HTML page and the WebSocket
upgrade require that token. Keep the URL private. The page sends a no-referrer
policy and is not cached. Browser WebSocket origins must match the local page;
non-browser clients without an Origin header still require the token.

The server uses local HTTP and `ws://`, rather than TLS. Incoming WebSocket
messages are limited to 16 MiB, including base64 images. Events are validated
before dispatch to the runtime; approvals must match the pending interaction,
and session operations cannot replace an active browser turn. Project file
previews reject traversal and symlinks resolving outside the project.

The page uses nonce-based script/style CSP and denies framing. Agent/tool output
is rendered as text or DOM-built Markdown rather than interpolated HTML.
Closing Nanocoder shuts down the browser server.

## Implementation and review

This feature follows the existing web-mode work associated with issue
[#628](https://github.com/Nano-Collective/nanocoder/issues/628).
Its browser integration is isolated in `source/app/hooks/useWebRuntime.ts`.
Review the complete files under `source/web/`, particularly `server.ts`,
`protocol.ts`, `runtime-bridge.ts`, and `workspace.ts`, when assessing the local
transport and runtime boundary. A truncated automated diff cannot establish
their correctness.

---
"@nanocollective/nanocoder": patch
"nanocoder-vscode": patch
---

This release introduces a suite of UI improvements to the VS Code chat panel and robust session state recovery:
- **Timeline Removed:** Deprecated and completely removed the action timeline feature and its internal event tracking.
- **Artifacts Redesign:** The artifacts list has been redesigned into a clean, collapsible container that can be toggled by the user.
- **Session History Durations:** Fixed a bug where history playback would render a duration of `0s` for cancelled or failed sessions. The chat data schema now officially tracks an `outcome` and guarantees a `durationMs` even on cancelled turns. *Note: Cancelling a turn strictly before the agent emits any thought or tool call drops the duration, because no work summary container was ever created to attach the metadata to.*
- **Stream-Time Footer Hiding:** The message footer (Retry, Copy, timestamp) dynamically hides while the agent is streaming its response, rendering a much cleaner interface that only shows actions once the agent completes.
- **Smooth Auto-Scroll:** Restored intelligent auto-scrolling where reading past messages prevents forced scroll-to-bottoms during a stream. A forced scroll is now selectively applied only when a run finishes or a session is loaded.
- **Wider User Bubbles:** The user prompt bubble max-width was expanded from 85% to 90%.

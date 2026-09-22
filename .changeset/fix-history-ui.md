---
"@nanocollective/nanocoder": patch
---

This release introduces a suite of UI improvements to the VS Code chat panel and robust session state recovery:
- **Timeline Removed:** Deprecated and completely removed the action timeline feature and its internal event tracking.
- **Artifacts Redesign:** The artifacts list has been redesigned into a clean, collapsible container that can be toggled by the user.
- **Session History Durations:** Fixed a bug where history playback would render a duration of `0s` for cancelled or failed sessions. The chat data schema now officially tracks an `outcome` (`'completed' | 'cancelled' | 'failed'`) and a `durationMs` on every assistant message. *Limitation: If a turn is cancelled before the agent emits any thought or tool call, no work summary container exists in the webview to display the duration. Those turns show no duration indicator at all (rather than the previous incorrect `0s`).*
- **Stream-Time Footer Hiding:** The message footer (Retry, Copy, timestamp) dynamically hides while the agent is streaming its response, rendering a much cleaner interface that only shows actions once the agent completes.
- **Smooth Auto-Scroll:** Restored intelligent auto-scrolling where reading past messages prevents forced scroll-to-bottoms during a stream. A forced scroll is now selectively applied only when a run finishes or a session is loaded.
- **Wider User Bubbles:** The user prompt bubble max-width was expanded from 85% to 90%.

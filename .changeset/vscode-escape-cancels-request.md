---
"@nanocollective/nanocoder": patch
---

Pressing Escape in the VS Code extension's chat panel now instantly cancels an in-flight LLM request, mirroring the Stop button. The listener is registered on the webview's `document` (not just the chat input) so it fires even when focus has moved to a tool card, button, or the streaming response area. Also added a `nanocoder.cancel` command for the Command Palette. The backend already tears down the in-flight request via `AbortController` when a cancel is received, so this stops token generation immediately rather than just hiding output — and cancelling now shows a clean "Cancelled by user" note inline in the chat instead of an error toast.

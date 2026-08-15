---
"@nanocollective/nanocoder": patch
---

Pressing Escape in the VS Code extension's chat panel now instantly cancels an in-flight LLM request, mirroring the Stop button.
The listener is registered on the webview's `document` (not just the chat input) so it fires even when focus has moved to a tool card, button, or the streaming response area.
Also added a `nanocoder.cancel` command for the Command Palette.
The backend already tears down the in-flight request via `AbortController` when a cancel is received, so this stops token generation immediately rather than just hiding output, and cancelling now shows a clean "Cancelled by user" note inline in the chat instead of an error toast.

Cancelling while a tool is waiting for approval no longer wedges the chat.
Previously the pending permission resolver was left in place, so the extension kept reporting an outstanding prompt and rejected every later message with "Please approve or deny the pending tool" until the window was reloaded.
Cancelling (or starting a new chat) now answers any outstanding permission requests with a cancelled outcome and dismisses their approval cards.

Fixed cancelled tool cards rendering with the error icon.
ACP has no `cancelled` tool status, so a cancel arrives as `failed` with `Cancelled by user` in the raw output, but the webview matched that string case-sensitively against `cancelled` and never hit it.

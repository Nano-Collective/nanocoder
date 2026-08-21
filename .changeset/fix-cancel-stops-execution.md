---
"@nanocollective/nanocoder": patch
---

Fixed the VS Code extension's stop button leaving a request running. Two holes: `AcpSession.cancel()` aborted the current controller and immediately replaced it with a fresh one, so a cancel that landed before the turn read the signal — the window while the agent is still resolving the prompt's file references — handed the turn an unaborted controller and the stop was lost. The controller is now rotated when a turn begins instead. Separately, the extension never answered the agent's pending permission request when you hit stop: the tool card kept its spinner and Allow/Deny buttons, and because the request stayed on the pending list every later message was refused with "Please approve or deny the pending tool before sending a new message" until the window was reloaded. Stopping (or reconnecting after the agent process restarts) now resolves those requests as cancelled. Thanks to @akramcodez. Closes #864.

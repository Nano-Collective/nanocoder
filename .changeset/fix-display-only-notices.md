---
"@nanocollective/nanocoder": patch
---

Stopped nanocoder's own UI text from being sent to the model as its past output. Cancellation notices (`_Cancelled by user._`), inline error banners (`**Error:** ...`), the non-interactive "Tool approval required" notice, and the VS Code replies to built-in slash commands (`/help`, `/copy`, `/model`, unrecognized commands) were all pushed into conversation history as `assistant` messages, so on the next turn the provider received harness-authored markdown as if the model had written it — teaching it to imitate the chrome and, on a resumed session, to believe it had errored. These are now marked display-only: they still render in the chat and replay with session history, but they are filtered out before messages are converted to the provider payload. Closes #893.

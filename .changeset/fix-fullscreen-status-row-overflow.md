---
"@nanocollective/nanocoder": patch
---

Fixed the status row under the prompt being cut mid-word in fullscreen (for example `norma` instead of `normal`) when the task badge and a session name share a narrow terminal. The row's width budget now accounts for the fullscreen frame's padding.

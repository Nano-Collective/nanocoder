---
"@nanocollective/nanocoder": patch
---

- **Image attachments now leave an `[Image #N]` placeholder in the message**. Dragged or typed image paths are no longer silently stripped from the user message - each becomes a numbered `[Image #N]` placeholder (mirroring the `[Paste #N]` convention), numbered after any images already attached via Ctrl+V, and highlighted in the chat history like `[@file]` mentions.

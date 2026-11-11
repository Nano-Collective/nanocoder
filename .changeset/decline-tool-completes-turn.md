---
"@nanocollective/nanocoder": patch
---

Declining a tool confirmation now ends the turn properly. Before, the app still treated the conversation as running, so any message you typed and queued while the prompt was up stayed stuck in the queue and was never sent. The same happened when cancelling with Escape settled the prompt.

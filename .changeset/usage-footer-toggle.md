---
"@nanocollective/nanocoder": patch
---

Made the per-response usage and cost footer optional. The gray footer under each assistant message is still on by default, but can now be turned off via `/settings` → Behavior → Tool Results and Thinking → **Usage & Cost Footer**, or by setting `showUsageFooter` to `false` in the preferences file. Turning it off removes the footer line entirely - both the provider-reported tokens and cost and the client-side token estimate - and applies to replayed session history and subagent transcripts as well as live responses. The preference is read per message, so toggling it takes effect from the next response without a restart, and the models.dev pricing lookup is skipped altogether when the footer is off.

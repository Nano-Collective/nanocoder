---
"@nanocollective/nanocoder": patch
---

An XML tool call that is never closed, or that leaves a parameter open, now goes back to the model as a malformed tool call so it can retry. Before, an unclosed call ended the turn with the raw XML as the reply, and a call with a parameter left open ran with that argument missing. Only calls to the tools offered to the model are checked. Code, prose that mentions a call, and XML inside another call's arguments are left alone, and a reply cut off at the output limit is still handled as a truncated turn. This applies to the interactive UI, `--plain`, ACP and subagents.

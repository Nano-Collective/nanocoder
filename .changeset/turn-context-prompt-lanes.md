---
'@nanocollective/nanocoder': patch
---

Skills matched for a request and project memories recalled for it now travel at the end of the user's message instead of being appended to the system prompt, so the system prompt and tool schemas stay byte-identical for a whole session. Inference backends only reuse their KV cache for the byte-identical prefix of a request, and because both blocks were derived from the current message, the system block differed on every turn — which meant re-processing the entire context, often tens of thousands of tokens, before each reply. Prompt-prefix logs now report `append-only` where they previously reported `system-changed` on every message, and local backends reuse the cached prefix. Applies to the TUI, `--plain`, ACP and subagents; replayed sessions show the message without the context block. Groundwork for #1574.

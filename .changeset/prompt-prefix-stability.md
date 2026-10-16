---
'@nanocollective/nanocoder': patch
---

The per-response usage indicator now shows what share of the prompt the provider served from its cache (`9.8k cached (82%)`), and debug logs report prompt prefix stability per request: whether a turn only appended messages, or whether the system prompt, tool schemas or earlier history changed — and for history, the index of the first rewritten message. Local inference backends only reuse their KV cache for the byte-identical prefix of a request, so a prefix break near the start of a 30k-token context means paying full prefill again; these two measurements make that visible instead of showing up only as slow responses. Groundwork for #1574.

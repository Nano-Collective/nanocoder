---
"@nanocollective/nanocoder": patch
---

Fixed the VS Code extension's thought dropdown expanding to nothing. Streamed tokens are batched behind a 150ms timer, but the reasoning/text routing flag was read when the batch flushed rather than when it filled — so providers that open the next stream inside that window (the OpenAI Responses API defers `reasoning-end` until the reasoning item completes; openai-compatible providers reopen reasoning without closing text) delivered reasoning as assistant text and left the thought view empty. Buffered tokens are now flushed before the switch, and whitespace-only reasoning no longer emits an ACP thought chunk or opens a thought section, so the empty "Thought for 0s" bubbles are gone. Thanks to @akramcodez. Closes #853.

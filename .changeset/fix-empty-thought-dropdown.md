---
"@nanocollective/nanocoder": patch
---

Fixed the VS Code extension's thought dropdown expanding to nothing. Streamed tokens are batched behind a 150ms timer, and the reasoning/text routing flag was driven by the `reasoning-start` / `text-start` markers around a batch rather than by the deltas that filled it — so any provider whose ordering differs (the OpenAI Responses API defers `reasoning-end` until the reasoning item completes; openai-compatible providers reopen reasoning without closing text; some emit deltas with no start marker at all) delivered reasoning as assistant text and left the thought view empty. Routing now follows the delta type and flushes the pending batch before switching streams, so a batch always leaves on the callback it was filled for. Whitespace-only reasoning no longer emits an ACP thought chunk, is no longer stored on the message, and no longer opens a thought section, so the empty "Thought for 0s" bubbles are gone. Thanks to @akramcodez. Closes #853.

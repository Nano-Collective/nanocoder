---
"@nanocollective/nanocoder": patch
---

Fixed `--plain` runs reporting success after the model's reply was cut off at the output-token limit. A truncated turn comes back as content with no tool calls, which is exactly what a finished turn looks like, so the headless loop returned `kind: 'success'` carrying half a sentence — and a run whose entire deliverable was a tool call could exit `0` having written nothing. `finishReason` is now carried out of the AI SDK client instead of only being logged, and a truncated content-only turn is asked to continue from where it stopped, up to `nanocoder.retries.maxTruncatedTurns` times (default 2, `0` restores the old accept-the-fragment behaviour). The nudge steers the model to make the outstanding tool call rather than re-explain itself, since spending the whole output budget narrating before acting is what triggers this.

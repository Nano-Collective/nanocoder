---
"@nanocollective/nanocoder": patch
---

Split prompts, replies, and tool lines so a long session is easier to scan. A prompt is a You: label with the text indented under it. A reply keeps the left rule, without the extra blank lines above and below the text. Tool activity sits indented, on one line. Closes #951.

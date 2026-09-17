---
"@nanocollective/nanocoder": patch
---

The streaming reasoning trace no longer re-wraps its entire history on every token flush. It now wraps only a bounded tail, the same way the streaming message does, and skips that work and the token count altogether while the panel is collapsed — which is the default, so the cost was being paid for a panel nobody could see. Measured over 30 flushes of a ~150KB trace: 91.9ms to 11.6ms per flush collapsed, 99.2ms to 25.2ms expanded. Closes #1329.

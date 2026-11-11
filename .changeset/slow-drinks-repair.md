---
"@nanocollective/nanocoder": patch
---

Load the Anthropic and Llama tokenizer packages lazily instead of at import time. The minimum Node version is now 22.12, since `llama-tokenizer-js` is ESM-only and is loaded with `require()`.

---
"@nanocollective/nanocoder": patch
---

Include the provider in the message token cache key. The tokenizer is chosen from provider and model together, so two providers serving the same model name were sharing cache entries and could report counts produced by the other provider's tokenizer.

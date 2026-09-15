---
"@nanocollective/nanocoder": patch
---

Fixed bash and custom-tool output getting garbled when a multi-byte UTF-8 character landed on a chunk boundary. Closes #1305.

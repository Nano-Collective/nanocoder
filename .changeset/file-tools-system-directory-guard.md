---
"@nanocollective/nanocoder": patch
---

Guard `file_op` move source in system directories (not just the destination), and keep copy source unrestricted. The shared `validatePathPair` validator now rejects a move source inside a system directory while still allowing a copy source, and a new serial test asserts that behavior.

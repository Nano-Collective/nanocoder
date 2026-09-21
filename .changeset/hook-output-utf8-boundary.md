---
"@nanocollective/nanocoder": patch
---

Fixed lifecycle hook output being garbled when a multi-byte UTF-8 character landed on a chunk boundary. Each chunk was decoded on its own with `chunk.toString()`, so both halves of a split sequence became U+FFFD. That is the same defect #1305 fixed for bash and custom tools by routing them through `utils/stream-collector.ts`; hooks were missed. It is not cosmetic output: `pre-tool-use` and `user-prompt-submit` stdout is handed to the model as the reason an action was denied, and `post-tool-use` stdout is folded into the tool result, so a formatter or linter emitting box-drawing characters, CJK paths or emoji status markers fed the model corrupted text. Each stream now decodes through a `StringDecoder` and is flushed when the process closes, so a stream ending on a partial sequence no longer drops its last character either. The character cap also stops mid-slice of a surrogate pair.

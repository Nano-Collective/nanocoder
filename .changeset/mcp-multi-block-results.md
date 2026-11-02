---
"@nanocollective/nanocoder": patch
---

MCP tool results now keep every content block. Only the first block was returned, so text in later blocks was lost and a leading image or audio block reached the model as raw base64 JSON. Text blocks are now joined with newlines and image and audio blocks are replaced by a short `[mime/type, N bytes]` placeholder. Closes #1932.

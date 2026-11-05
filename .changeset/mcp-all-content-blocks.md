---
"@nanocollective/nanocoder": patch
---

MCP tool results now keep every content block. Only the first block used to reach the model, so text in later blocks was lost, and a leading image came through as raw base64 JSON. Text blocks are now joined with newlines. Image, audio and binary resource blocks become a short placeholder such as `[image/png, 3 bytes]`. Embedded text resources keep their text, under a `[resource <uri>]` line. Closes #1932.

---
"@nanocollective/nanocoder": patch
---

Fixed daemon startup on macOS when the project-local socket path is too long. Nanocoder now checks the full socket path against macOS' Unix socket path limit and falls back to a stable hashed socket name in the system temp directory, avoiding libuv's documented Unix socket path truncation behavior.

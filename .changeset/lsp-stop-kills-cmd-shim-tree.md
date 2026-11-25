---
"@nanocollective/nanocoder": patch
---

On Windows, stopping a language server now ends the server itself, not only the `.cmd` shim that npm installs it through. A server that ignored the LSP `exit` notification, or one that refused `initialize`, previously kept running after Nanocoder stopped its client. Closes #2340.

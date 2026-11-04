---
"@nanocollective/nanocoder": patch
---

Nanocoder now warns when two MCP servers expose a tool with the same name. Tools are keyed by name, so only one server's tool was reachable and the other was hidden without any notice. The warning names each shared tool, the servers that expose it, and the server its calls go to.

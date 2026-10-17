---
"@nanocollective/nanocoder": minor
---

Add AI! watch comments feature (Aider-style). Users can now drop AI!, AI?, or AI markers at the end of comment lines in any file. When file watching is enabled (daemon mode), nanocoder automatically detects new markers and triggers a subagent to resolve the comment. The marker types are: AI! for imperative fixes, AI? for questions, and AI for general requests. Only new markers trigger events - existing markers are tracked and ignored to prevent duplicate runs. This provides universal editor support (VS Code, Vim, IntelliJ, etc.) without needing specific IDE plugins.

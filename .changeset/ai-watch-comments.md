---
"@nanocollective/nanocoder": minor
---

Add AI! watch comments (Aider-style). Drop `AI!` (do this) or `AI?` (answer this) at the end of a comment line in any file, and when the daemon is watching files, nanocoder triggers the subscribed skill's subagent to resolve it. A skill opts in with a `file.ai-comment` subscription, and the daemon only reads changed files for markers when one exists. Markers are matched in exact case in code comments (`//`, `#`, `--`, `/* */`, `<!-- -->`, and ` * ` lines), prose files such as Markdown are skipped, and a bare "AI" is not a marker. Only new markers fire: markers already in the tree at startup are recorded first, and a marker whose line moved is not new. This gives universal editor support (VS Code, Vim, IntelliJ, etc.) without an IDE plugin.

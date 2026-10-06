---
"@nanocollective/nanocoder": minor
---

Project memories now record the git commit, branch and a content hash of every tracked file they mention when they are saved. On recall, a memory whose referenced file has since been edited (including uncommitted edits) or deleted is injected with a short `[WARNING: recorded at <commit>, <file> has changed since. Verify before trusting.]` prefix, so the model checks the file instead of trusting stale context. Memories saved before this change, and memories saved outside a git repository, are recalled exactly as before. Closes #1572.

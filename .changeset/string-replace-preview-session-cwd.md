---
'@nanocollective/nanocoder': patch
---

After a bash `cd`, the `string_replace` approval preview and the ACP edit diff read the file in that directory. They used to open the same relative path from the directory nanocoder was started in. Closes #1634.

The preview labels the file with its path from the project root (or its absolute path outside it), so an edit in `sub` reads as `sub/<file>`.

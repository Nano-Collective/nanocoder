---
'@nanocollective/nanocoder': patch
---

`write_file` now shows a real diff (added/removed lines) against the file's previous content when overwriting an existing file, matching `string_replace`'s colored-diff treatment, in both the confirmation preview and the post-execution result — including auto-accept/yolo mode, where the file is overwritten before the result is ever displayed. Writing a brand-new file still shows the full syntax-highlighted dump. Closes #1288.

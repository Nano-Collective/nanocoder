---
"@nanocollective/nanocoder": patch
---

Fixed pressing Enter immediately after typing a slash-command fragment submitting the raw fragment. The completion menu opens a render after the keystroke, so an Enter landing in between saw it closed. Enter now selects from the completions about to be shown, and still submits a command once its completion has been selected. Closes #1327.

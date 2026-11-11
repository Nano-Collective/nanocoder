---
'@nanocollective/nanocoder': patch
---

The tool approval dialog no longer accepts Enter before the call has been checked. The Yes/No choice used to be live from the moment the dialog opened, with "Yes" already highlighted, so pressing Enter while the validator ran or while "Loading preview..." showed approved the tool before you could see what it would do. The dialog now shows "Checking tool call..." or "Loading preview..." until the schema check, validator, and preview are done, and only then shows Yes/No. Escape still cancels at any time. Closes #1407 and #1814.

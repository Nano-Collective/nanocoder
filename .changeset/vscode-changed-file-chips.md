---
"@nanocollective/nanocoder": minor
---

Added created and modified files to the VS Code extension's context panel: every file the agent writes during a turn now appears as a chip above the composer as soon as the edit lands, and clicking it opens the current version in the editor for review. The chips are dashed to set them apart from files you attached yourself, survive sending a message, and can be dismissed individually; they are deliberately not inlined into the next prompt, since the agent just wrote them. Closes #857.

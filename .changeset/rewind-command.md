---
"@nanocollective/nanocoder": minor
---

Add `/rewind`: pick an earlier prompt and restore the files and/or the conversation to how they were just before it, with the prompt loaded back into the input for editing. File restore uses the timeline's per-tool before-images, so only files the agent changed are touched, and the exact restore/delete list is shown for confirmation first. Prompts are recorded automatically as they are sent; bash side effects are not undone.

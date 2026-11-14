---
"@nanocollective/nanocoder": minor
---

Prompts containing an `@file` mention that cannot be attached now show a warning above the input instead of silently leaving the mention as plain text. The warning names the missing path and suggests a close match when one exists; pressing Enter again sends the message with a note telling the model the file was not attached. Closes #2023.

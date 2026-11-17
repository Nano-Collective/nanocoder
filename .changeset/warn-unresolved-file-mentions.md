---
"@nanocollective/nanocoder": minor
---

Prompts containing an `@file` mention that cannot be attached now show a warning above the input instead of silently leaving the mention as plain text. The warning names the missing path and suggests a close match when one exists; pressing Enter again sends the message with a note telling the model the file was not attached. Only unresolvable mentions are flagged, and prose such as annotations, version numbers, bare handles or paths inside code spans is left alone. Closes #2023.

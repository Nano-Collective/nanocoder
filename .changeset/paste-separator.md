---
"@nanocollective/nanocoder": patch
---

Two pastes made back to back no longer fuse in the message sent to the model. The composer showed two tidy placeholders, but they expanded flush against each other at submit, joining the last line of the first paste to the first line of the second. A paste placeholder now goes on its own line wherever it would otherwise touch other text, whether it is appended or spliced in at the caret. Existing whitespace on either side is left as it is. Closes #1373.

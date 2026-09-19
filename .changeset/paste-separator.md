---
"@nanocollective/nanocoder": patch
---

Two pastes made back to back no longer fuse in the message sent to the model. The composer showed two tidy placeholders, but they expanded flush against each other at submit, joining the last line of the first paste to the first line of the second. An appended paste now starts on its own line unless the composer already ends in whitespace. Closes #1373.

---
'@nanocollective/nanocoder': minor
---

Added `/fork [title]` to copy the current conversation into a new session and continue there. The fork gets a new session id, defaults to a `<title> (fork)` name, and is marked as a fork of the original in the `/resume` selector; the original session stays available in `/resume` untouched. Closes #2018.

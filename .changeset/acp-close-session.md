---
"@nanocollective/nanocoder": patch
---

ACP clients can now close a session. Nanocoder had advertised `session/close` since ACP sessions were added but never handled it, so a client that called it got a method-not-found error. Closing cancels any running turn, stops prompts already queued behind it from starting, releases the session's timeline lock and drops the session from memory. The session stays on disk, so it can be loaded or resumed later.

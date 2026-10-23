---
"@nanocollective/nanocoder": patch
---

Closing an ACP session now waits for its cancelled turn to finish before releasing the session's timeline lock, so a checkpoint still being written can no longer land after the lock is gone. Closing also clears the session's cached file-read state.

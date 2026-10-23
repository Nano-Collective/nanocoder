---
"@nanocollective/nanocoder": patch
---

CI watch in the daemon no longer stops polling for good after an unexpected error. Previously only the `gh` call was guarded, so a failure resolving the current branch, a malformed run list, or a failed investigation dispatch ended polling until the daemon restarted. Errors are now logged and the next poll is scheduled with backoff, and one failed dispatch no longer skips the other failed runs from the same poll. `pollIntervalMs` is also clamped to a minimum of 5 seconds.

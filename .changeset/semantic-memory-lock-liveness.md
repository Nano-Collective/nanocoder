---
"@nanocollective/nanocoder": patch
---

Fixed the semantic memory lock being stolen from a process that was still using it. The lock file's mtime was stamped once at acquisition and never refreshed, so "held for more than ten seconds" and "abandoned" were the same test. Any write that legitimately took longer had its lock deleted by a waiter in another process; both then ran the critical section at once and finished with `atomicWriteFile`, so the loser's memories were silently dropped rather than merged. The in-process queue meant this only bit across processes - two sessions in one repo, or a session plus the daemon, which is exactly what repo-scoped memory is for.

Ownership is now decided by whether the recorded owner is still running, with the heartbeat as a tiebreak. A holder refreshes the lock's mtime every two seconds while it works, so a waiter can tell "still going" from "gone". A dead owner is reclaimed immediately however fresh the file looks, which also removes the ten-second stall a crashed session used to impose on the next write. A live owner whose heartbeat has stopped for longer than the stale window is still reclaimed, covering both a wedged holder and a recorded pid that has been recycled by an unrelated process.

---
"@nanocollective/nanocoder": patch
---

Fixed the checkpoint file scan spawning an extra `git` process on every call. Detecting a repository with no commits used to run `git rev-parse --verify HEAD` before every diff, so the common case — a repository that has commits — paid for a probe that could only ever succeed. Since the scan runs on each checkpoint and twice per ACP tool call, that was a spawn per invocation for a branch almost never taken. The diff is now attempted directly and the unborn case is handled when it fails, which costs one spawn instead of two and leaves the captured file list unchanged. Files in a repository without commits, staged or untracked, are still captured, and a directory that is not a git repository at all still reports git as unavailable so checkpointing is skipped rather than recording an empty snapshot.

---
"@nanocollective/nanocoder": patch
---

Fixed two `/repomap` indexing bugs and added a progress spinner. Python docstring bodies are no longer indexed as definitions (the `"""` and `'''` branches were unreachable in the comment-stripping pattern, so names inside a docstring were reported as real symbols and sorted ahead of them), and a repo holding exactly `maxFiles` indexable files is no longer reported as truncated. `/repomap` now shows a "Building repo map" spinner while it scans, and reuses the shared `calculateTokens` helper for its budget maths.

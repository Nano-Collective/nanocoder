---
"@nanocollective/nanocoder": patch
---

Fixed checkpoints capturing no files in a repository with no commits. `getModifiedFilesResult` diffed against `HEAD`, which does not exist on an unborn branch, so the whole scan fell to its catch and reported git as unavailable — every file in a `git init`ed workspace looked unmodified, and a checkpoint taken there restored nothing. The scan now checks for `HEAD` first and diffs the index with `git diff --name-only --cached` when there is none, so a staged tree (`git init && git add .`, or `git checkout --orphan`, which starts with a fully populated index) is captured rather than skipped; `--others` alone would have missed all of it, because `git ls-files --others` excludes anything already in the index. This affects checkpoint creation and both timeline scans, which branch on the `available` flag. A genuine `git diff` failure still falls through to the existing error handling and reports git as unavailable, unchanged.

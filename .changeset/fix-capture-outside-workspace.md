---
"@nanocollective/nanocoder": patch
---

Refuse to snapshot a file from outside the workspace. Snapshot keys are the file's path relative to the workspace, so a file above it was keyed `../name` and would have been written outside the checkpoint's own files directory. `captureFiles` now drops those paths and reports them through `skipped`, so an incomplete checkpoint still says so at restore time. The same containment rule already guarded restore and delete and is now shared by all three.

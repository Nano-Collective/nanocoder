---
"@nanocollective/nanocoder": patch
---

Stop a checkpoint snapshot writing outside its checkpoint directory. A snapshot is keyed by its path relative to the workspace, so a file captured from outside the workspace arrives as `../name` and was joined straight onto the checkpoint's `files` directory. Those paths are now dropped before the metadata records them, and revalidated when a checkpoint is restored, since `metadata.json` may have been written before this fix.

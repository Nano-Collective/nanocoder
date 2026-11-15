---
"@nanocollective/nanocoder": patch
---

The voice plugin now starts its helper commands through `cross-spawn` instead of `child_process.spawn`, so `REC_CMD`, `PLAY_CMD`, `WHISPER_CMD` and `PIPER_CMD` work when they point at a `.cmd` or `.bat` shim on Windows. Node 22 refuses to spawn those files with a bare `spawn` and threw `EINVAL`, which broke recording, playback and transcription on Windows. Fixes #1937.

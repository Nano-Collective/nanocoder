---
"@nanocollective/nanocoder": patch
---

Voice setup on macOS now downloads the Whisper speech model. The macOS installer fetched sox, whisper-cpp and Piper but never `ggml-base.en.bin`, so transcription failed straight after a successful install. The model is now downloaded with the same checksum check as on Linux and Windows, and the dependency check counts a missing model (in the voice bin directory, or at `WHISPER_MODEL` when set) as Whisper not being installed, so an existing macOS install is offered the download on the next `/voice`.

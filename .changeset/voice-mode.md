---
'@nanocollective/nanocoder': minor
---

- Added voice mode. `/voice` turns it on, with push-to-talk on `Ctrl+G` or hands-free speech detection, local Whisper speech-to-text and local Piper text-to-speech by default, and opt-in OpenAI cloud STT/TTS. Speaking or pressing `Ctrl+G` interrupts a running response. The audio tools are installed on first use, with checksums verified. Hands-free mode is paused in yolo mode so background speech cannot trigger unconfirmed tool calls. Thanks to @RONAK-AI647. Closes #622.
- Cancelling a bash command now also stops background processes it left running, and force-kills any that ignore the normal stop signal after two seconds.

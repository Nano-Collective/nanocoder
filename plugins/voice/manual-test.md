# Manual Voice Plugin Test

Since CI does not have microphone or speaker hardware, you can manually verify the voice plugin by running the script below.

## Prerequisites
1. **Sox**: Ensure `sox` is installed on your system.
   - Mac: `brew install sox`
   - Linux: `sudo apt-get install sox`
   - Windows: Download sox or use WSL (with audio support).
2. **Models (Optional)**: 
   - Ensure `whisper-cli` and `piper` are available in your path or their corresponding environment variables (`WHISPER_CMD`, `PIPER_CMD`) are set, along with model paths if you want to test STT/TTS. If they aren't available, only the recording/playback will work.


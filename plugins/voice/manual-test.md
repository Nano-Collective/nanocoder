# Manual Voice Plugin Test

Since CI does not have microphone or speaker hardware, you can manually verify the voice plugin by running the script below.

## Prerequisites
1. **Sox**: Ensure `sox` is installed on your system.
   - Mac: `brew install sox`
   - Linux: `sudo apt-get install sox`
   - Windows: Download sox or use WSL (with audio support).
2. **Models (Optional)**: 
   - Ensure `whisper-cli` and `piper` are available in your path or their corresponding environment variables (`WHISPER_CMD`, `PIPER_CMD`) are set, along with model paths if you want to test STT/TTS. If they aren't available, only the recording/playback will work.

## Test Steps

You can use the environment variable override mechanism (the same one our test suite uses) to mock binaries if you don't have real `sox`, `whisper-cli`, or `piper` installed.

1. **Test Recording & Playback (Mocked)**
   ```bash
   REC_CMD="echo mocked-record" PLAY_CMD="echo mocked-play" npx tsx src/index.ts
   ```
   *Note: Since `index.ts` is just a library export, you can create a temporary runner script to invoke `recordAudio` and `playAudio` directly to see the execution.*

2. **Test End-to-End Transcription & Speech (Mocked)**
   Save this as `run-test.ts` in the voice plugin directory:
   ```typescript
   import { recordAudio, playAudio, transcribeAudio, synthesizeSpeech } from './src/index.ts';

   async function run() {
     console.log('Recording mock audio...');
     await recordAudio('test.wav', 1000);
     
     console.log('Playing mock audio...');
     await playAudio('test.wav');

     console.log('Transcribing...');
     const text = await transcribeAudio('test.wav');
     console.log('Transcription result:', text);

     console.log('Synthesizing speech...');
     await synthesizeSpeech('Hello world', 'out.wav');
   }
   run();
   ```

   Run it with mocked binaries:
   ```bash
   REC_CMD="sleep 1" PLAY_CMD="sleep 1" WHISPER_CMD="echo mocked STT result" PIPER_CMD="sleep 1" npx tsx run-test.ts
   ```
   **Expected Output**:
   ```
   Recording mock audio...
   Playing mock audio...
   Transcribing...
   Transcription result: mocked STT result
   Synthesizing speech...
   ```

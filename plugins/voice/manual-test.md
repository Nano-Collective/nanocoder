# Manual Voice Plugin Test

Since CI does not have microphone or speaker hardware, you can manually verify the voice plugin by running the script below.

## Prerequisites
1. **Sox**: Ensure `sox` is installed on your system.
   - Mac: `brew install sox`
   - Linux: `sudo apt-get install sox`
   - Windows: Download sox or use WSL (with audio support).
2. **Models (Optional)**: 
   - Ensure `whisper-cli` and `piper` are available in your path or their corresponding environment variables (`WHISPER_CMD`, `PIPER_CMD`) are set, along with model paths if you want to test STT/TTS. If they aren't available, only the recording/playback will work.

## Test Script

Create a `test.js` file in `plugins/voice/` and run it with `node test.js`:

```javascript
import { recordAudio, playAudio, playPhrase, transcribeAudio } from './dist/index.js';
import { join } from 'path';

async function run() {
    const testFile = join(process.cwd(), 'test-recording.wav');

    console.log('🎤 Recording for 3 seconds...');
    await recordAudio(testFile, 3000);
    console.log('✅ Recording finished');

    console.log('🔊 Playing back recording...');
    await playAudio(testFile);
    console.log('✅ Playback finished');

    try {
        console.log('🗣️ Transcribing...');
        const text = await transcribeAudio(testFile);
        console.log(`📝 Transcription: "${text}"`);

        console.log('🤖 Synthesizing confirmation phrase...');
        await playPhrase("Test completed successfully!");
    } catch (err) {
        console.warn('⚠️ STT/TTS step skipped/failed (ensure whisper-cli and piper are installed):', err.message);
    }
}

run().catch(console.error);
```

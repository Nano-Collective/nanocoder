import {randomUUID} from 'node:crypto';
import {existsSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {playAudio} from './speaker.js';
import {synthesizeSpeech} from './tts.js';

/**
 * Generates and plays back a spoken phrase using local TTS.
 * This is a generic utility for audio confirmations (e.g., "Voice mode activated").
 *
 * @param text The phrase to speak
 */
export async function playPhrase(text: string): Promise<void> {
	const tempFile = join(tmpdir(), `nanocoder-tts-${randomUUID()}.wav`);
	try {
		await synthesizeSpeech(text, tempFile);
		await playAudio(tempFile);
	} finally {
		if (existsSync(tempFile)) {
			try {
				unlinkSync(tempFile);
			} catch {
				// Best effort cleanup
			}
		}
	}
}

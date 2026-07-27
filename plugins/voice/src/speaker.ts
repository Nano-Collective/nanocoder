import cp from 'node:child_process';
import { platform } from 'node:process';

/**
 * Plays an audio file through the default system speakers.
 * Uses native OS tools where available (afplay, aplay) and falls back to sox's play.
 * 
 * @param filePath The path to the audio file to play.
 */
export async function playAudio(filePath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		let command = process.env.PLAY_CMD || 'play'; // default to sox
		const args = [filePath];

		if (process.env.PLAY_CMD) {
			// Testing override
		} else if (platform === 'darwin') {
			command = 'afplay';
		} else if (platform === 'linux') {
			command = 'aplay';
			args.unshift('-q'); // quiet mode
		} else if (platform === 'win32') {
			command = 'sox';
			args.unshift('-q');
			args.push('-d'); // route to default device
		} else {
			args.unshift('-q');
		}

		const proc = cp.spawn(command, args, { stdio: 'ignore' });

		proc.on('close', (code) => {
			if (code === 0 || code === null) {
				resolve();
			} else {
				reject(new Error(`Audio playback failed with exit code ${code}.`));
			}
		});

		proc.on('error', (err) => {
			reject(new Error(`Failed to start audio playback process (${command}): ${err.message}`));
		});
	});
}

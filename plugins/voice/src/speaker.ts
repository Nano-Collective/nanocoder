import cp from 'node:child_process';
import { platform } from 'node:process';

/**
 * Plays an audio file through the default system speakers.
 * Uses native OS tools where available (afplay on macOS, sox's play on Linux/WSL, sox on Windows).
 * 
 * @param filePath The path to the audio file to play.
 */
export async function playAudio(filePath: string, timeoutMs?: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			return reject(new Error('AbortError: Playback aborted'));
		}

		let command = process.env.PLAY_CMD || 'play'; // default to sox play
		const args = ['-q', filePath];

		if (process.env.PLAY_CMD) {
			// Testing override
			args.shift();
		} else if (platform === 'darwin') {
			command = 'afplay';
			args.shift(); // remove -q
		} else if (platform === 'win32') {
			command = 'sox';
			args.push('-d'); // route to default device
		}

		const proc = cp.spawn(command, args, { stdio: 'ignore' });

		let timeoutId: NodeJS.Timeout | undefined;
		if (timeoutMs && timeoutMs > 0) {
			timeoutId = setTimeout(() => {
				proc.kill('SIGTERM');
				reject(new Error(`Playback timed out after ${timeoutMs}ms`));
			}, timeoutMs);
		}

		const abortHandler = () => {
			proc.kill('SIGTERM');
			reject(new Error('AbortError: Playback aborted'));
		};

		if (signal) {
			signal.addEventListener('abort', abortHandler);
		}

		proc.on('close', (code) => {
			if (timeoutId) clearTimeout(timeoutId);
			if (signal) signal.removeEventListener('abort', abortHandler);
			if (code === 0 || code === null) {
				resolve();
			} else {
				reject(new Error(`Audio playback failed with exit code ${code}.`));
			}
		});

		proc.on('error', (err) => {
			if (timeoutId) clearTimeout(timeoutId);
			if (signal) signal.removeEventListener('abort', abortHandler);
			reject(new Error(`Failed to start audio playback process (${command}): ${err.message}`));
		});
	});
}

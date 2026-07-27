import cp from 'node:child_process';
import { platform } from 'node:process';

/**
 * Records audio from the default system microphone.
 * 
 * @param filePath The path where the .wav file should be saved.
 * @param durationMs Optional duration to record for, in milliseconds. If omitted, records until the process is killed.
 */
export async function recordAudio(filePath: string, durationMs?: number): Promise<void> {
	return new Promise((resolve, reject) => {
		// sox's `rec` is the most reliable cross-platform CLI for this, assuming it is installed.
		let command = process.env.REC_CMD || 'rec';
		const args = ['-q', filePath]; // -q for quiet mode

		if (durationMs) {
			args.push('trim', '0', (durationMs / 1000).toString());
		}

		if (platform === 'win32' && !process.env.REC_CMD) {
			command = 'sox';
			// on Windows, rec might not be in PATH directly, use sox -d (default audio device)
			args.unshift('-d');
		}

		const proc = cp.spawn(command, args, { stdio: 'ignore' });

		let timeoutId: NodeJS.Timeout | undefined;
		if (durationMs) {
			// Fallback timeout to kill the process if it doesn't stop on its own
			timeoutId = setTimeout(() => {
				proc.kill('SIGTERM');
			}, durationMs + 1000);
		}

		proc.on('close', (code) => {
			if (timeoutId) clearTimeout(timeoutId);
			if (code === 0 || code === null) {
				resolve();
			} else {
				reject(new Error(`Microphone recording failed with exit code ${code}. Please ensure 'sox' is installed.`));
			}
		});

		proc.on('error', (err) => {
			if (timeoutId) clearTimeout(timeoutId);
			reject(new Error(`Failed to start microphone recording process: ${err.message}. Please install 'sox'.`));
		});
	});
}

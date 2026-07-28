import cp from 'node:child_process';
import { platform } from 'node:process';

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB limit for safety

/**
 * Transcribes audio from a .wav file to text using local whisper.cpp.
 * Follows the bash-executor stream handling pattern to prevent memory exhaustion.
 * 
 * @param filePath Path to the .wav audio file
 * @param timeoutMs Maximum time to wait in milliseconds (defaults to 60000)
 * @returns The transcribed text
 */
export async function transcribeAudio(filePath: string, timeoutMs = 60000, signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			return reject(new Error('AbortError: Transcription aborted'));
		}

		const command = process.env.WHISPER_CMD || 'whisper-cli';
		const modelPath = process.env.WHISPER_MODEL || 'ggml-base.en.bin';
		
		const args = ['-m', modelPath, '-f', filePath, '-nt']; // -nt disables timestamps

		const proc = cp.spawn(command, args, { 
			stdio: ['ignore', 'pipe', 'ignore'] 
		});

		let timeoutId: NodeJS.Timeout | undefined;
		if (timeoutMs > 0) {
			timeoutId = setTimeout(() => {
				proc.kill('SIGTERM');
				reject(new Error(`Transcription timed out after ${timeoutMs}ms`));
			}, timeoutMs);
		}

		const abortHandler = () => {
			proc.kill('SIGTERM');
			reject(new Error('AbortError: Transcription aborted'));
		};

		if (signal) {
			signal.addEventListener('abort', abortHandler);
		}

		let output = '';
		let outputBytes = 0;
		let outputTruncated = false;

		proc.stdout.on('data', (data: Buffer) => {
			if (outputBytes < MAX_OUTPUT_BYTES) {
				const remaining = MAX_OUTPUT_BYTES - outputBytes;
				const chunk = data.subarray(0, remaining);
				output += chunk.toString();
				outputBytes += chunk.length;

				if (outputBytes >= MAX_OUTPUT_BYTES && !outputTruncated) {
					outputTruncated = true;
					output += '\n... [Output truncated]';
				}
			}
		});

		proc.on('close', (code) => {
			if (timeoutId) clearTimeout(timeoutId);
			if (signal) signal.removeEventListener('abort', abortHandler);
			if (code === 0 || code === null) {
				resolve(output.trim());
			} else {
				reject(new Error(`Whisper STT failed with exit code ${code}`));
			}
		});

		proc.on('error', (err) => {
			if (timeoutId) clearTimeout(timeoutId);
			if (signal) signal.removeEventListener('abort', abortHandler);
			reject(new Error(`Failed to start Whisper STT (${command}): ${err.message}`));
		});
	});
}

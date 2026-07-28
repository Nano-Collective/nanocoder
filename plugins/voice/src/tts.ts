import cp from 'node:child_process';
import { platform } from 'node:process';

/**
 * Synthesizes speech from text using local piper TTS.
 * 
 * @param text The text to synthesize
 * @param outputPath The path where the generated .wav file should be saved
 * @param timeoutMs Maximum time to wait in milliseconds (defaults to 30000)
 */
export async function synthesizeSpeech(text: string, outputPath: string, timeoutMs = 30000, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			return reject(new Error('AbortError: Synthesis aborted'));
		}

		const command = process.env.PIPER_CMD || 'piper';
		const modelPath = process.env.PIPER_MODEL || 'en_US-lessac-medium.onnx';

		const args = ['--model', modelPath, '--output_file', outputPath];
		
		const proc = cp.spawn(command, args, { 
			stdio: ['pipe', 'ignore', 'ignore']
		});

		let timeoutId: NodeJS.Timeout | undefined;
		if (timeoutMs > 0) {
			timeoutId = setTimeout(() => {
				proc.kill('SIGTERM');
				reject(new Error(`Synthesis timed out after ${timeoutMs}ms`));
			}, timeoutMs);
		}

		const abortHandler = () => {
			proc.kill('SIGTERM');
			reject(new Error('AbortError: Synthesis aborted'));
		};

		if (signal) {
			signal.addEventListener('abort', abortHandler);
		}

		proc.stdin.on('error', (err: any) => {
			if (err.code !== 'EPIPE') {
				reject(new Error(`Failed to write to Piper TTS: ${err.message}`));
			}
		});
		proc.stdin.write(text);
		proc.stdin.end();

		proc.on('close', (code) => {
			if (timeoutId) clearTimeout(timeoutId);
			if (signal) signal.removeEventListener('abort', abortHandler);
			if (code === 0 || code === null) {
				resolve();
			} else {
				reject(new Error(`Piper TTS failed with exit code ${code}`));
			}
		});

		proc.on('error', (err) => {
			if (timeoutId) clearTimeout(timeoutId);
			if (signal) signal.removeEventListener('abort', abortHandler);
			reject(new Error(`Failed to start Piper TTS (${command}): ${err.message}`));
		});
	});
}

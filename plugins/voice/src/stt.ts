import cp from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {platform} from 'node:process';
import {getVoiceBinDir} from './dependencies.js';

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB limit for safety

const SILENCE_MARKER_REGEX =
	/^\s*(\[BLANK_AUDIO\]|\[silence\]|\(silence\)|\(_BEG_\)|\(_END_\))\s*$/i;

export function filterSilenceMarkers(text: string): string {
	const trimmed = text.trim();
	if (SILENCE_MARKER_REGEX.test(trimmed)) {
		return '';
	}
	// Also strip isolated leading/trailing [BLANK_AUDIO] tokens
	return trimmed.replace(/\[BLANK_AUDIO\]/gi, '').trim();
}

function resolveWhisperCommand(): string {
	if (process.env.WHISPER_CMD) return process.env.WHISPER_CMD;
	const localBin = join(
		getVoiceBinDir(),
		platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli',
	);
	if (existsSync(localBin)) return localBin;
	return 'whisper-cli';
}

function resolveWhisperModel(): string {
	if (process.env.WHISPER_MODEL) return process.env.WHISPER_MODEL;
	const localModel = join(getVoiceBinDir(), 'ggml-base.en.bin');
	if (existsSync(localModel)) return localModel;
	return 'ggml-base.en.bin';
}

/**
 * Transcribes audio from a .wav file to text using local whisper.cpp.
 *
 * @param filePath Path to the .wav audio file
 * @param timeoutMs Maximum time to wait in milliseconds (defaults to 60000)
 * @param signal AbortSignal to cancel transcription
 * @returns The transcribed text (or empty string if silence)
 */
export async function transcribeAudio(
	filePath: string,
	timeoutMs = 60000,
	signal?: AbortSignal,
): Promise<string> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			return reject(new Error('AbortError: Transcription aborted'));
		}

		const command = resolveWhisperCommand();
		const modelPath = resolveWhisperModel();

		const args = ['-m', modelPath, '-f', filePath, '-nt']; // -nt disables timestamps

		const proc = cp.spawn(command, args, {
			stdio: ['ignore', 'pipe', 'ignore'],
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

		proc.on('close', code => {
			if (timeoutId) clearTimeout(timeoutId);
			if (signal) signal.removeEventListener('abort', abortHandler);
			if (code === 0) {
				resolve(filterSilenceMarkers(output));
			} else {
				reject(new Error(`Whisper STT failed with exit code ${code}`));
			}
		});

		proc.on('error', err => {
			if (timeoutId) clearTimeout(timeoutId);
			if (signal) signal.removeEventListener('abort', abortHandler);
			reject(
				new Error(
					`Failed to start Whisper STT process (${command}): ${err.message}`,
				),
			);
		});
	});
}

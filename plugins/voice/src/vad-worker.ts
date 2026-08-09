import { parentPort, workerData } from 'node:worker_threads';
import cp from 'node:child_process';
import { platform } from 'node:process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';

/**
 * Worker thread for Voice Activity Detection (VAD).
 * 
 * NOTE ON VAD ARCHITECTURE:
 * This uses a frame-based RMS energy detection algorithm over raw PCM 16kHz 16-bit audio.
 * It is a simpler, zero-native-dependency approach compared to Silero VAD or WebRTC VAD.
 * Known v1 limitation: It may be more sensitive to background noise and acoustic environment
 * fluctuations than neural / ML-based VAD models.
 */

const speechThreshold = workerData?.speechThreshold ?? 1500;
const silenceThreshold = workerData?.silenceThreshold ?? 800;
const silenceDurationMs = workerData?.silenceDurationMs ?? 1000;
const frameSize = 512; // 16kHz 16-bit mono PCM sample frame size (1024 bytes)

let isSpeech = false;
let silenceStart = 0;
let audioChunks: Buffer[] = [];

const recCmd = process.env.REC_CMD || (platform === 'win32' ? 'sox' : 'rec');
const recArgs = platform === 'win32' 
	? ['-q', '-d', '-t', 'raw', '-r', '16000', '-b', '16', '-c', '1', '-e', 'signed-integer', '-']
	: ['-q', '-t', 'raw', '-r', '16000', '-b', '16', '-c', '1', '-e', 'signed-integer', '-'];

const proc = cp.spawn(recCmd, recArgs, { stdio: ['ignore', 'pipe', 'ignore'] });

function calculateRms(buffer: Buffer): number {
	let sum = 0;
	const count = buffer.length / 2;
	for (let i = 0; i < buffer.length; i += 2) {
		const sample = buffer.readInt16LE(i);
		sum += sample * sample;
	}
	return Math.sqrt(sum / (count || 1));
}

let remainder: Buffer = Buffer.alloc(0);

proc.stdout.on('data', (chunk: Buffer) => {
	const data = Buffer.concat([remainder, chunk]);
	const bytesPerFrame = frameSize * 2;
	let offset = 0;

	while (offset + bytesPerFrame <= data.length) {
		const frame = data.subarray(offset, offset + bytesPerFrame);
		offset += bytesPerFrame;

		const rms = calculateRms(frame);

		if (rms > speechThreshold) {
			if (!isSpeech) {
				isSpeech = true;
				parentPort?.postMessage({ type: 'speech_start' });
			}
			audioChunks.push(Buffer.from(frame));
			silenceStart = 0;
		} else if (isSpeech) {
			audioChunks.push(Buffer.from(frame));
			if (rms < silenceThreshold) {
				const now = Date.now();
				if (silenceStart === 0) {
					silenceStart = now;
				} else if (now - silenceStart >= silenceDurationMs) {
					isSpeech = false;
					silenceStart = 0;

					const pcmData = Buffer.concat(audioChunks);
					audioChunks = [];

					const wavHeader = createWavHeader(pcmData.length, 16000, 1, 16);
					const wavBuffer = Buffer.concat([wavHeader, pcmData]);

					const tempFile = join(tmpdir(), 'nanocoder-vad-' + randomUUID() + '.wav');
					writeFileSync(tempFile, wavBuffer);

					parentPort?.postMessage({
						type: 'speech_final',
						filePath: tempFile,
					});
				}
			} else {
				silenceStart = 0;
			}
		}
	}

	remainder = data.subarray(offset);
});

proc.on('error', (err) => {
	parentPort?.postMessage({ type: 'error', error: err.message });
});

parentPort?.on('message', (msg) => {
	if (msg === 'stop') {
		proc.kill('SIGTERM');
		process.exit(0);
	}
});

function createWavHeader(dataLength: number, sampleRate: number, numChannels: number, bitsPerSample: number): Buffer {
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + dataLength, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(numChannels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
	header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write('data', 36);
	header.writeUInt32LE(dataLength, 40);
	return header;
}

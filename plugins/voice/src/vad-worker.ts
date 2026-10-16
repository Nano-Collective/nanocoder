import cp from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {platform} from 'node:process';
import {parentPort, workerData} from 'node:worker_threads';
import {SpeechDetector} from './vad-detector.js';

/**
 * Worker thread for Voice Activity Detection (VAD). Owns the `rec` process
 * and feeds its PCM stream through `SpeechDetector` (see vad-detector.ts).
 *
 * NOTE ON VAD ARCHITECTURE:
 * This uses a frame-based RMS energy detection algorithm over raw PCM 16kHz 16-bit audio.
 * It is a simpler, zero-native-dependency approach compared to Silero VAD or WebRTC VAD.
 * Known v1 limitation: It may be more sensitive to background noise and acoustic environment
 * fluctuations than neural / ML-based VAD models.
 */

const frameSize = 512; // 16kHz 16-bit mono PCM sample frame size (1024 bytes)

const detector = new SpeechDetector({
	speechThreshold: workerData?.speechThreshold,
	silenceThreshold: workerData?.silenceThreshold,
	silenceDurationMs: workerData?.silenceDurationMs,
	minSpeechDurationMs: workerData?.minSpeechDurationMs,
});

const recCmd = process.env.REC_CMD || (platform === 'win32' ? 'sox' : 'rec');
const recArgs =
	platform === 'win32'
		? [
				'-q',
				'-d',
				'-t',
				'raw',
				'-r',
				'16000',
				'-b',
				'16',
				'-c',
				'1',
				'-e',
				'signed-integer',
				'-',
			]
		: [
				'-q',
				'-t',
				'raw',
				'-r',
				'16000',
				'-b',
				'16',
				'-c',
				'1',
				'-e',
				'signed-integer',
				'-',
			];

const proc = cp.spawn(recCmd, recArgs, {stdio: ['ignore', 'pipe', 'ignore']});
let stopping = false;

let remainder: Buffer = Buffer.alloc(0);

function writeUtterance(pcmData: Buffer): void {
	const wavHeader = createWavHeader(pcmData.length, 16000, 1, 16);
	const wavBuffer = Buffer.concat([wavHeader, pcmData]);
	const tempFile = join(tmpdir(), 'nanocoder-vad-' + randomUUID() + '.wav');
	writeFileSync(tempFile, wavBuffer);
	parentPort?.postMessage({type: 'speech_final', filePath: tempFile});
}

proc.stdout.on('data', (chunk: Buffer) => {
	const data = Buffer.concat([remainder, chunk]);
	const bytesPerFrame = frameSize * 2;
	let offset = 0;

	while (offset + bytesPerFrame <= data.length) {
		const frame = data.subarray(offset, offset + bytesPerFrame);
		offset += bytesPerFrame;

		for (const event of detector.process(frame)) {
			if (event.type === 'speech_start') {
				parentPort?.postMessage({type: 'speech_start'});
			} else {
				writeUtterance(event.pcm);
			}
		}
	}

	remainder = data.subarray(offset);
});

proc.on('error', err => {
	parentPort?.postMessage({type: 'error', error: err.message});
});

proc.on('close', code => {
	if (!stopping && code !== 0) {
		parentPort?.postMessage({
			type: 'error',
			error: `Recording process exited with code ${code}`,
		});
	}
});

parentPort?.on('message', msg => {
	if (msg === 'stop') {
		stopping = true;
		try {
			proc.kill('SIGINT');
		} catch {}

		const forceKillTimer = setTimeout(() => {
			try {
				proc.kill('SIGKILL');
			} catch {}
			try {
				parentPort?.postMessage({type: 'stopped'});
			} catch {}
			process.exit(0);
		}, 600);

		proc.once('close', () => {
			clearTimeout(forceKillTimer);
			try {
				parentPort?.postMessage({type: 'stopped'});
			} catch {}
			process.exit(0);
		});
	}
});

function createWavHeader(
	dataLength: number,
	sampleRate: number,
	numChannels: number,
	bitsPerSample: number,
): Buffer {
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

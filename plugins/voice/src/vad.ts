import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface VadEngineOptions {
	speechThreshold?: number;
	silenceThreshold?: number;
	silenceDurationMs?: number;
	workerPath?: string;
}

export type VadEventMap = {
	speech_start: [];
	speech_final: [{ filePath: string }];
	error: [Error];
};

export class VadEngine extends EventEmitter {
	private worker: Worker | null = null;
	private isRunning = false;
	private options: VadEngineOptions;

	constructor(options: VadEngineOptions = {}) {
		super();
		this.options = options;
	}

	public start(): void {
		if (this.isRunning) return;

		const defaultWorkerPath = join(
			dirname(fileURLToPath(import.meta.url)),
			'vad-worker.js',
		);
		const workerScript = this.options.workerPath || defaultWorkerPath;

		this.worker = new Worker(workerScript, {
			workerData: {
				speechThreshold: this.options.speechThreshold,
				silenceThreshold: this.options.silenceThreshold,
				silenceDurationMs: this.options.silenceDurationMs,
			},
		});

		this.worker.on('message', (msg: any) => {
			if (msg?.type === 'speech_start') {
				this.emit('speech_start');
			} else if (msg?.type === 'speech_final') {
				this.emit('speech_final', { filePath: msg.filePath });
			} else if (msg?.type === 'error') {
				this.emit('error', new Error(msg.error));
			}
		});

		this.worker.on('error', (err) => {
			this.emit('error', err);
		});

		this.isRunning = true;
	}

	public stop(): void {
		if (!this.isRunning || !this.worker) return;
		this.worker.postMessage('stop');
		this.worker.terminate();
		this.worker = null;
		this.isRunning = false;
	}
}

export function createVadEngine(options?: VadEngineOptions): VadEngine {
	return new VadEngine(options);
}

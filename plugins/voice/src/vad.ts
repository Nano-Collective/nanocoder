import {EventEmitter} from 'node:events';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';

export interface VadEngineOptions {
	speechThreshold?: number;
	silenceThreshold?: number;
	silenceDurationMs?: number;
	workerPath?: string;
}

type WorkerMessage =
	| {type: 'speech_start'}
	| {type: 'speech_final'; filePath: string}
	| {type: 'error'; error: string}
	| {type: 'stopped'};

export type VadEventMap = {
	speech_start: [];
	speech_final: [{filePath: string}];
	error: [Error];
};

export class VadEngine extends EventEmitter<VadEventMap> {
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

		this.worker.on('message', (msg: WorkerMessage) => {
			if (msg?.type === 'speech_start') {
				this.emit('speech_start');
			} else if (msg?.type === 'speech_final') {
				this.emit('speech_final', {filePath: msg.filePath});
			} else if (msg?.type === 'error') {
				this.emit('error', new Error(msg.error));
			}
		});

		this.worker.on('error', err => {
			this.emit('error', err instanceof Error ? err : new Error(String(err)));
		});

		this.isRunning = true;
	}

	public async stop(): Promise<void> {
		if (!this.isRunning || !this.worker) return;
		const worker = this.worker;
		this.worker = null;
		this.isRunning = false;

		await new Promise<void>(resolve => {
			let resolved = false;
			const cleanup = () => {
				if (!resolved) {
					resolved = true;
					resolve();
				}
			};

			const timeout = setTimeout(() => {
				void worker.terminate().then(cleanup, cleanup);
			}, 800);

			worker.once('message', (msg: WorkerMessage) => {
				if (msg?.type === 'stopped') {
					clearTimeout(timeout);
					void worker.terminate().then(cleanup, cleanup);
				}
			});

			worker.once('exit', () => {
				clearTimeout(timeout);
				cleanup();
			});

			try {
				worker.postMessage('stop');
			} catch {
				clearTimeout(timeout);
				void worker.terminate().then(cleanup, cleanup);
			}
		});
	}
}

export function createVadEngine(options?: VadEngineOptions): VadEngine {
	return new VadEngine(options);
}

export const SWARM_MODES = ['review', 'apply', 'yolo'] as const;
export type SwarmMode = (typeof SWARM_MODES)[number];

export const DEFAULT_SWARM_WORKERS = 4;
export const MAX_SWARM_WORKERS = 10;
export const DEFAULT_SWARM_TIMEOUT_MINUTES = 30;

export interface SwarmConfig {
	prompt: string;
	workers: number;
	swarmMode: SwarmMode;
	timeoutMs: number;
}

export type SwarmStatus =
	| 'decomposing'
	| 'running'
	| 'verifying'
	| 'awaiting-confirmation'
	| 'applying'
	| 'complete'
	| 'failed';

export type WorkerStatus =
	| 'pending'
	| 'running'
	| 'success'
	| 'failed'
	| 'cancelled';

export interface WorkerState {
	id: string;
	status: WorkerStatus;
	fileScope: string[];
	turns: number;
	tokens: number;
	currentTool?: string;
	error?: string;
}

export interface SwarmPatch {
	id: string;
	files: string[];
	patchPath: string;
}

export interface SwarmSnapshot {
	status: SwarmStatus;
	workers: WorkerState[];
	patches: SwarmPatch[];
	applied: boolean;
	/** Directory holding this run's patches and logs, relative to the repo. */
	runDir?: string;
	error?: string;
}

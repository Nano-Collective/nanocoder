export type AgentPhase =
	| 'idle'
	| 'retrieval'
	| 'planning'
	| 'generation'
	| 'execution';

export type VramStrategy = 'aggressive' | 'balanced' | 'disabled';

export type ModelRole = 'coder' | 'embedder' | 'router' | 'vision';

export interface ModelResidencyState {
	model: string;
	role: ModelRole;
	isLoaded: boolean;
	lastUsedAt: number;
	backendUrl?: string;
}

export interface VramConfig {
	enabled: boolean;
	strategy: VramStrategy;
	unloadOnExecution: boolean;
	keepAliveMinutes: number;
}

export const VRAM_DEFAULTS: VramConfig = {
	enabled: true,
	strategy: 'balanced',
	unloadOnExecution: true,
	keepAliveMinutes: 5,
};

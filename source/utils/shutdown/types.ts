export interface ShutdownHandler {
	name: string;
	priority: number;
	handler: () => Promise<void>;
}

export interface ShutdownManagerOptions {
	timeoutMs?: number;
}

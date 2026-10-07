import type {
	AgentPhase,
	ModelResidencyState,
	ModelRole,
	VramConfig,
} from '@/types/vram';
import {VRAM_DEFAULTS} from '@/types/vram';

export class VramAllocator {
	private currentPhase: AgentPhase = 'idle';
	private config: VramConfig;
	private readonly models: Map<string, ModelResidencyState> = new Map();

	constructor(config?: Partial<VramConfig>) {
		this.config = {...VRAM_DEFAULTS, ...config};
	}

	getCurrentPhase(): AgentPhase {
		return this.currentPhase;
	}

	getConfig(): VramConfig {
		return {...this.config};
	}

	setConfig(newConfig: Partial<VramConfig>): void {
		this.config = {...this.config, ...newConfig};
	}

	registerModel(
		model: string,
		role: ModelRole = 'coder',
		backendUrl?: string,
	): void {
		const key = model.toLowerCase().trim();
		const existing = this.models.get(key);
		if (existing) {
			existing.role = role;
			if (backendUrl) existing.backendUrl = backendUrl;
		} else {
			this.models.set(key, {
				model,
				role,
				isLoaded: false,
				lastUsedAt: Date.now(),
				backendUrl,
			});
		}
	}

	getResidencyStates(): ModelResidencyState[] {
		return Array.from(this.models.values());
	}

	async transitionPhase(
		newPhase: AgentPhase,
		options?: {
			toolName?: string;
			model?: string;
			backendUrl?: string;
		},
	): Promise<void> {
		this.currentPhase = newPhase;

		if (!this.config.enabled || this.config.strategy === 'disabled') {
			return;
		}

		if (options?.model) {
			this.registerModel(options.model, 'coder', options.backendUrl);
		}

		switch (newPhase) {
			case 'retrieval': {
				// Pin embedders, evict coder if aggressive
				for (const state of this.models.values()) {
					if (state.role === 'embedder') {
						await this.pinModel(
							state.model,
							this.config.keepAliveMinutes,
							state.backendUrl || options?.backendUrl,
						);
					} else if (
						this.config.strategy === 'aggressive' &&
						state.role === 'coder'
					) {
						await this.evictModel(
							state.model,
							state.backendUrl || options?.backendUrl,
						);
					}
				}
				break;
			}

			case 'generation': {
				// Evict embedders to free VRAM for generation context & KV cache
				for (const state of this.models.values()) {
					if (state.role === 'embedder') {
						await this.evictModel(
							state.model,
							state.backendUrl || options?.backendUrl,
						);
					}
				}
				if (options?.model) {
					await this.pinModel(
						options.model,
						this.config.keepAliveMinutes,
						options.backendUrl,
					);
				}
				break;
			}

			case 'execution': {
				// If executing heavy tools (e.g. bash commands), evict to yield RAM/VRAM back to OS
				const isHeavyTool =
					!options?.toolName ||
					options.toolName === 'execute_bash' ||
					this.config.strategy === 'aggressive';

				if (this.config.unloadOnExecution && isHeavyTool) {
					for (const state of this.models.values()) {
						await this.evictModel(
							state.model,
							state.backendUrl || options?.backendUrl,
						);
					}
				}
				break;
			}

			case 'idle': {
				if (this.config.strategy === 'aggressive') {
					for (const state of this.models.values()) {
						await this.evictModel(
							state.model,
							state.backendUrl || options?.backendUrl,
						);
					}
				}
				break;
			}

			case 'planning':
			default:
				break;
		}
	}

	async evictModel(model: string, backendUrl?: string): Promise<boolean> {
		const key = model.toLowerCase().trim();
		const state = this.models.get(key);
		if (state) {
			state.isLoaded = false;
		}

		return await dispatchOllamaKeepAlive(model, 0, backendUrl);
	}

	async pinModel(
		model: string,
		durationMinutes: number,
		backendUrl?: string,
	): Promise<boolean> {
		const key = model.toLowerCase().trim();
		const state = this.models.get(key);
		if (state) {
			state.isLoaded = true;
			state.lastUsedAt = Date.now();
		}

		return await dispatchOllamaKeepAlive(
			model,
			`${durationMinutes}m`,
			backendUrl,
		);
	}

	clear(): void {
		this.models.clear();
		this.currentPhase = 'idle';
	}
}

async function dispatchOllamaKeepAlive(
	model: string,
	keepAlive: number | string,
	baseURL?: string,
): Promise<boolean> {
	const url = (baseURL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
	// Standard Ollama generate endpoint with keep_alive payload
	const endpoint = url.endsWith('/v1')
		? `${url.slice(0, -3)}/api/generate`
		: url.endsWith('/api')
			? `${url}/generate`
			: `${url}/api/generate`;

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 1000);

		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({
				model,
				keep_alive: keepAlive,
			}),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);
		return response.ok;
	} catch {
		// Local endpoint might not be Ollama or reachable, return false gracefully
		return false;
	}
}

let globalVramAllocator: VramAllocator | null = null;

export function getVramAllocator(): VramAllocator {
	if (!globalVramAllocator) {
		globalVramAllocator = new VramAllocator();
	}
	return globalVramAllocator;
}

export function resetVramAllocator(): void {
	globalVramAllocator = null;
}

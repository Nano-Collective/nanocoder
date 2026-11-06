import {getAppConfig} from '@/config/index';
import type {
	AgentPhase,
	ModelResidencyState,
	ModelRole,
	VramConfig,
} from '@/types/vram';
import {VRAM_DEFAULTS} from '@/types/vram';

/**
 * Resolves the connection settings (baseURL, apiKey, headers) for communicating
 * with Ollama. Checks the explicit override first, then looks up the provider
 * configuration from agents.config.json. Requires the resolved provider to be
 * an Ollama provider (type === 'ollama' or name containing 'ollama') to prevent
 * leaking API keys or dispatching keep_alive requests to third-party endpoints.
 */
export function resolveOllamaConnection(
	provider?: string,
	model?: string,
	backendUrlOverride?: string,
): {baseURL: string; apiKey?: string; headers?: Record<string, string>} | null {
	if (backendUrlOverride) {
		return {baseURL: backendUrlOverride};
	}

	try {
		const providers = getAppConfig().providers ?? [];
		if (provider) {
			const matched = providers.find(
				p => p.name.toLowerCase() === provider.toLowerCase(),
			);
			if (matched) {
				const isOllama =
					(typeof matched.type === 'string' &&
						matched.type.toLowerCase() === 'ollama') ||
					matched.name.toLowerCase().includes('ollama');
				if (!isOllama) {
					return null;
				}
				return {
					baseURL: matched.baseUrl || 'http://127.0.0.1:11434',
					apiKey: matched.apiKey,
				};
			}
		}

		if (model) {
			const modelLower = model.toLowerCase().trim();
			const matched = providers.find(
				p =>
					((typeof p.type === 'string' && p.type.toLowerCase() === 'ollama') ||
						p.name.toLowerCase().includes('ollama')) &&
					p.models?.some(m => m.toLowerCase().trim() === modelLower),
			);
			if (matched) {
				return {
					baseURL: matched.baseUrl || 'http://127.0.0.1:11434',
					apiKey: matched.apiKey,
				};
			}
		}

		const defaultOllama = providers.find(
			p =>
				(typeof p.type === 'string' && p.type.toLowerCase() === 'ollama') ||
				p.name.toLowerCase().includes('ollama'),
		);
		if (defaultOllama) {
			return {
				baseURL: defaultOllama.baseUrl || 'http://127.0.0.1:11434',
				apiKey: defaultOllama.apiKey,
			};
		}
	} catch {
		// Fall through
	}

	return null;
}

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
			provider?: string;
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
						await this.pinModel(state.model, this.config.keepAliveMinutes, {
							provider: options?.provider,
							backendUrl: state.backendUrl || options?.backendUrl,
						});
					} else if (
						this.config.strategy === 'aggressive' &&
						state.role === 'coder'
					) {
						await this.evictModel(state.model, {
							provider: options?.provider,
							backendUrl: state.backendUrl || options?.backendUrl,
						});
					}
				}
				break;
			}

			case 'generation': {
				// Evict embedders to free VRAM for generation context & KV cache
				for (const state of this.models.values()) {
					if (state.role === 'embedder') {
						await this.evictModel(state.model, {
							provider: options?.provider,
							backendUrl: state.backendUrl || options?.backendUrl,
						});
					}
				}
				if (options?.model) {
					await this.pinModel(options.model, this.config.keepAliveMinutes, {
						provider: options?.provider,
						backendUrl: options.backendUrl,
					});
				}
				break;
			}

			case 'execution': {
				// If executing heavy tools (e.g. bash commands), evict to yield RAM/VRAM back to OS
				const isHeavyTool =
					options?.toolName === 'execute_bash' ||
					this.config.strategy === 'aggressive';

				if (this.config.unloadOnExecution && isHeavyTool) {
					for (const state of this.models.values()) {
						await this.evictModel(state.model, {
							provider: options?.provider,
							backendUrl: state.backendUrl || options?.backendUrl,
						});
					}
				}
				break;
			}

			case 'idle': {
				if (this.config.strategy === 'aggressive') {
					for (const state of this.models.values()) {
						await this.evictModel(state.model, {
							provider: options?.provider,
							backendUrl: state.backendUrl || options?.backendUrl,
						});
					}
				}
				break;
			}

			case 'planning':
			default:
				break;
		}
	}

	async evictModel(
		model: string,
		options?: string | {provider?: string; backendUrl?: string},
	): Promise<boolean> {
		const key = model.toLowerCase().trim();
		const state = this.models.get(key);
		if (state) {
			state.isLoaded = false;
		}

		const backendUrl =
			typeof options === 'string' ? options : options?.backendUrl;
		const provider =
			typeof options === 'object' ? options?.provider : undefined;
		const conn = resolveOllamaConnection(provider, model, backendUrl);
		if (!conn) {
			return false;
		}

		return await dispatchOllamaKeepAlive(model, 0, conn);
	}

	async pinModel(
		model: string,
		durationMinutes: number,
		options?: string | {provider?: string; backendUrl?: string},
	): Promise<boolean> {
		const key = model.toLowerCase().trim();
		const state = this.models.get(key);
		if (state) {
			state.isLoaded = true;
			state.lastUsedAt = Date.now();
		}

		const backendUrl =
			typeof options === 'string' ? options : options?.backendUrl;
		const provider =
			typeof options === 'object' ? options?.provider : undefined;
		const conn = resolveOllamaConnection(provider, model, backendUrl);
		if (!conn) {
			return false;
		}

		return await dispatchOllamaKeepAlive(model, `${durationMinutes}m`, conn);
	}

	clear(): void {
		this.models.clear();
		this.currentPhase = 'idle';
	}
}

/**
 * Dispatches a keep_alive call to Ollama (/api/generate endpoint).
 * Sends Authorization headers if apiKey is present in the connection config.
 */
export async function dispatchOllamaKeepAlive(
	model: string,
	keepAlive: number | string,
	connection?:
		| {
				baseURL?: string;
				apiKey?: string;
				headers?: Record<string, string>;
		  }
		| string,
): Promise<boolean> {
	const conn =
		typeof connection === 'string'
			? {baseURL: connection}
			: (connection ?? {baseURL: 'http://127.0.0.1:11434'});
	const url = (conn.baseURL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
	// Standard Ollama generate endpoint with keep_alive payload
	const endpoint = url.endsWith('/v1')
		? `${url.slice(0, -3)}/api/generate`
		: url.endsWith('/api')
			? `${url}/generate`
			: `${url}/api/generate`;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...(conn.apiKey ? {Authorization: `Bearer ${conn.apiKey}`} : {}),
		...(conn.headers ?? {}),
	};

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 200);

		const response = await fetch(endpoint, {
			method: 'POST',
			headers,
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

/**
 * Returns the singleton VramAllocator instance.
 * For test isolation, tests should call resetVramAllocator() in beforeEach/afterEach.
 */
export function getVramAllocator(): VramAllocator {
	if (!globalVramAllocator) {
		globalVramAllocator = new VramAllocator();
	}
	return globalVramAllocator;
}

/**
 * Resets the singleton VramAllocator instance.
 * Intended for test cleanup and isolation across test cases.
 */
export function resetVramAllocator(): void {
	globalVramAllocator = null;
}

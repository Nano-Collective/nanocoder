/**
 * Ask the inference server which context window it is actually serving.
 *
 * Catalogue values (models.dev, the built-in Ollama table) describe what a
 * model supports, not what the server loaded. Ollama in particular serves a
 * much smaller `num_ctx` than the model maximum and silently truncates the
 * front of the prompt on overflow, so trusting the catalogue means the
 * compaction threshold is never reached.
 *
 * Supported shapes:
 * - Ollama:    POST /api/show      -> `num_ctx` parameter, else `<arch>.context_length`
 * - llama.cpp: GET  /props         -> default_generation_settings.n_ctx
 * - vLLM:      GET  /v1/models     -> data[].max_model_len
 *
 * Every request has a short timeout, the probe never throws, and results
 * (including misses) are cached per base URL and model for the session.
 */

import {TIMEOUT_CONTEXT_PROBE_MS} from '@/constants';
import type {AIProviderConfig, ProviderConfig} from '@/types/config';
import {formatError} from '@/utils/error-formatter';
import {getLogger} from '@/utils/logging';

export type ServerKind = 'ollama' | 'llama-cpp' | 'vllm';

type ProbeProviderConfig = AIProviderConfig | ProviderConfig;

const probeCache = new Map<string, Promise<number | null>>();

/** Forget every cached probe result (used by tests). */
export function resetServerContextProbeCache(): void {
	probeCache.clear();
}

function positiveInt(value: unknown): number | null {
	return typeof value === 'number' && Number.isInteger(value) && value > 0
		? value
		: null;
}

/** Both config shapes carry the same fields, nested under `config` or flat. */
function connectionFields(config: ProbeProviderConfig): {
	baseURL?: unknown;
	apiKey?: unknown;
	headers?: Record<string, string>;
} {
	if ('baseUrl' in config) {
		return {
			baseURL: config.baseUrl,
			apiKey: config.apiKey,
			headers: config.headers,
		};
	}
	return (config as AIProviderConfig).config ?? {};
}

function getBaseUrl(config: ProbeProviderConfig): string | null {
	const raw = connectionFields(config).baseURL;
	if (typeof raw !== 'string' || raw.trim() === '') {
		return null;
	}
	try {
		const url = new URL(raw);
		return url.protocol === 'http:' || url.protocol === 'https:' ? raw : null;
	} catch {
		return null;
	}
}

/** Strip a trailing `/v1` and slashes: the servers' native routes sit at the root. */
function getOrigin(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function isLocalHost(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
	return (
		host === 'localhost' ||
		host === '::1' ||
		host.endsWith('.local') ||
		/^127\./.test(host) ||
		/^10\./.test(host) ||
		/^192\.168\./.test(host) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(host)
	);
}

/**
 * Work out which server shape to try, in order. A provider name or well-known
 * default port is a strong hint and yields a single probe. Without a hint,
 * only local/private hosts are probed (Ollama, llama.cpp, vLLM in that
 * order); an unhinted remote host is most likely a hosted API with no such
 * endpoints, so it is skipped rather than sent three speculative requests.
 */
export function detectServerKinds(config: ProbeProviderConfig): ServerKind[] {
	const baseUrl = getBaseUrl(config);
	if (!baseUrl) {
		return [];
	}
	// Only the OpenAI-compatible SDK path talks to self-hosted servers.
	const sdkProvider = config.sdkProvider;
	if (sdkProvider && sdkProvider !== 'openai-compatible') {
		return [];
	}

	const url = new URL(baseUrl);
	const label = `${config.name} ${url.hostname}`.toLowerCase();
	if (label.includes('ollama') || url.port === '11434') {
		return ['ollama'];
	}
	if (
		/llama[-_. ]?cpp|llamacpp|llama-server/.test(label) ||
		url.port === '8080'
	) {
		return ['llama-cpp'];
	}
	if (label.includes('vllm') || url.port === '8000') {
		return ['vllm'];
	}
	return isLocalHost(url.hostname) ? ['ollama', 'llama-cpp', 'vllm'] : [];
}

function buildHeaders(config: ProbeProviderConfig): Record<string, string> {
	const headers: Record<string, string> = {};
	const {apiKey, headers: custom} = connectionFields(config);
	if (typeof apiKey === 'string' && apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}
	return {...headers, ...(custom ?? {})};
}

async function requestJson(
	url: string,
	init: {method: 'GET' | 'POST'; body?: unknown},
	headers: Record<string, string>,
): Promise<unknown> {
	const response = await fetch(url, {
		method: init.method,
		headers: {
			...headers,
			...(init.body !== undefined ? {'Content-Type': 'application/json'} : {}),
		},
		body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
		signal: AbortSignal.timeout(TIMEOUT_CONTEXT_PROBE_MS),
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
	return response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * Ollama: `num_ctx` from the Modelfile/`parameters` text is the value the
 * server will actually load the model with, so it wins. Only when no
 * `num_ctx` is set do we fall back to the architecture `context_length` from
 * `model_info`. That second value is the model's trained maximum, not
 * necessarily what the server allocates (Ollama's default window is smaller),
 * but it is the best figure `/api/show` exposes and is still the real model
 * metadata for the exact tag in use, unlike the name-matched catalogue.
 */
export function parseOllamaShow(body: unknown): number | null {
	if (!isRecord(body)) {
		return null;
	}
	if (typeof body.parameters === 'string') {
		const match = /^\s*num_ctx\s+(\d+)\s*$/m.exec(body.parameters);
		const numCtx = match ? positiveInt(Number.parseInt(match[1], 10)) : null;
		if (numCtx) {
			return numCtx;
		}
	}
	if (isRecord(body.model_info)) {
		for (const [key, value] of Object.entries(body.model_info)) {
			if (key.endsWith('.context_length')) {
				const length = positiveInt(value);
				if (length) {
					return length;
				}
			}
		}
	}
	return null;
}

function parseLlamaCppProps(body: unknown): number | null {
	if (!isRecord(body) || !isRecord(body.default_generation_settings)) {
		return null;
	}
	return positiveInt(body.default_generation_settings.n_ctx);
}

function parseVllmModels(body: unknown, modelId: string): number | null {
	if (!isRecord(body) || !Array.isArray(body.data)) {
		return null;
	}
	for (const entry of body.data) {
		if (isRecord(entry) && entry.id === modelId) {
			return positiveInt(entry.max_model_len);
		}
	}
	return null;
}

async function probeKind(
	kind: ServerKind,
	origin: string,
	modelId: string,
	headers: Record<string, string>,
): Promise<number | null> {
	switch (kind) {
		case 'ollama':
			return parseOllamaShow(
				await requestJson(
					`${origin}/api/show`,
					{method: 'POST', body: {model: modelId}},
					headers,
				),
			);
		case 'llama-cpp':
			return parseLlamaCppProps(
				await requestJson(`${origin}/props`, {method: 'GET'}, headers),
			);
		case 'vllm':
			return parseVllmModels(
				await requestJson(`${origin}/v1/models`, {method: 'GET'}, headers),
				modelId,
			);
	}
}

async function runProbe(
	config: ProbeProviderConfig,
	modelId: string,
): Promise<number | null> {
	const baseUrl = getBaseUrl(config);
	if (!baseUrl) {
		return null;
	}
	const origin = getOrigin(baseUrl);
	const headers = buildHeaders(config);
	const logger = getLogger();

	for (const kind of detectServerKinds(config)) {
		try {
			const limit = await probeKind(kind, origin, modelId, headers);
			if (limit) {
				logger.debug({kind, modelId, limit}, 'Detected served context window');
				return limit;
			}
		} catch (error) {
			logger.debug(
				{kind, modelId, error: formatError(error)},
				'Context window probe failed',
			);
		}
	}
	return null;
}

/**
 * Context window the server reports for this model, or null when it cannot be
 * determined. Never throws. The first call per base URL and model performs the
 * probe; later calls (including concurrent ones) share its result.
 */
export function probeServerContextLimit(
	config: ProbeProviderConfig | undefined,
	modelId: string,
): Promise<number | null> {
	if (!config) {
		return Promise.resolve(null);
	}
	const baseUrl = getBaseUrl(config);
	if (!baseUrl || detectServerKinds(config).length === 0) {
		return Promise.resolve(null);
	}

	const key = `${getOrigin(baseUrl)}|${modelId}`;
	let pending = probeCache.get(key);
	if (!pending) {
		pending = runProbe(config, modelId).catch(() => null);
		probeCache.set(key, pending);
	}
	return pending;
}

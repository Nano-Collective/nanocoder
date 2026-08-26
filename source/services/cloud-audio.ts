import {readFileSync, writeFileSync} from 'node:fs';
import {basename} from 'node:path';
import type {AIProviderConfig} from '@/types/config';

export class CloudAudioError extends Error {
	constructor(
		message: string,
		public readonly code?: string,
	) {
		super(message);
		this.name = 'CloudAudioError';
	}
}

export class CloudAudioUnsupportedError extends CloudAudioError {
	constructor(providerName?: string) {
		super(
			`Provider ${providerName || 'unknown'} does not support cloud STT/TTS endpoints.`,
			'UNSUPPORTED_PROVIDER',
		);
		this.name = 'CloudAudioUnsupportedError';
	}
}

export function supportsCloudAudio(providerConfig?: AIProviderConfig | null): {
	stt: boolean;
	tts: boolean;
} {
	if (!providerConfig) {
		return {stt: false, tts: false};
	}

	const sdk = providerConfig.sdkProvider || providerConfig.name;
	const isOpenAICompatible =
		sdk === 'openai' ||
		sdk === 'openai-compatible' ||
		providerConfig.name.toLowerCase().includes('openai') ||
		(providerConfig.config?.baseURL &&
			providerConfig.config.baseURL.includes('api.openai.com'));

	return {
		stt: Boolean(isOpenAICompatible),
		tts: Boolean(isOpenAICompatible),
	};
}

export interface CloudSTTOptions {
	providerConfig?: AIProviderConfig | null;
	timeoutMs?: number;
	signal?: AbortSignal;
	fetchFn?: typeof fetch;
}

export interface CloudTTSOptions {
	providerConfig?: AIProviderConfig | null;
	timeoutMs?: number;
	signal?: AbortSignal;
	voice?: string;
	fetchFn?: typeof fetch;
}

/**
 * Transcribe audio via cloud endpoint (e.g. OpenAI /v1/audio/transcriptions)
 */
export async function transcribeCloudAudio(
	filePath: string,
	options: CloudSTTOptions = {},
): Promise<string> {
	const {providerConfig, timeoutMs = 60_000, signal, fetchFn = fetch} = options;

	if (!supportsCloudAudio(providerConfig).stt) {
		throw new CloudAudioUnsupportedError(providerConfig?.name);
	}

	const apiKey =
		providerConfig?.config?.apiKey || process.env.OPENAI_API_KEY || '';

	if (!apiKey) {
		throw new CloudAudioError(
			`No API key configured for cloud STT (provider: ${providerConfig?.name || 'unknown'}).`,
			'MISSING_API_KEY',
		);
	}

	const baseUrl = (
		providerConfig?.config?.baseURL || 'https://api.openai.com/v1'
	).replace(/\/+$/, '');

	const endpoint = `${baseUrl}/audio/transcriptions`;

	const fileBuffer = readFileSync(filePath);
	const fileName = basename(filePath) || 'audio.wav';
	const fileBlob = new Blob([fileBuffer], {type: 'audio/wav'});

	const formData = new FormData();
	formData.append('file', fileBlob, fileName);
	formData.append('model', 'whisper-1');

	const abortController = new AbortController();
	const timer = setTimeout(() => abortController.abort(), timeoutMs);

	if (signal) {
		signal.addEventListener('abort', () => abortController.abort());
	}

	try {
		const response = await fetchFn(endpoint, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
			body: formData,
			signal: abortController.signal,
		});

		if (!response.ok) {
			const errBody = await response.text().catch(() => '');
			throw new CloudAudioError(
				`Cloud STT failed with status ${response.status}: ${errBody || response.statusText}`,
				'HTTP_ERROR',
			);
		}

		const data = (await response.json()) as {text?: string};
		return data.text || '';
	} catch (err) {
		if (err instanceof CloudAudioError) throw err;
		if (signal?.aborted || abortController.signal.aborted) {
			throw new CloudAudioError('Cloud STT aborted', 'ABORTED');
		}
		throw new CloudAudioError(
			`Cloud STT request failed: ${err instanceof Error ? err.message : String(err)}`,
			'NETWORK_ERROR',
		);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Synthesize speech via cloud endpoint (e.g. OpenAI /v1/audio/speech)
 */
export async function synthesizeCloudSpeech(
	text: string,
	outputPath: string,
	options: CloudTTSOptions = {},
): Promise<void> {
	const {
		providerConfig,
		timeoutMs = 60_000,
		signal,
		voice = 'alloy',
		fetchFn = fetch,
	} = options;

	if (!supportsCloudAudio(providerConfig).tts) {
		throw new CloudAudioUnsupportedError(providerConfig?.name);
	}

	const apiKey =
		providerConfig?.config?.apiKey || process.env.OPENAI_API_KEY || '';

	if (!apiKey) {
		throw new CloudAudioError(
			`No API key configured for cloud TTS (provider: ${providerConfig?.name || 'unknown'}).`,
			'MISSING_API_KEY',
		);
	}

	const baseUrl = (
		providerConfig?.config?.baseURL || 'https://api.openai.com/v1'
	).replace(/\/+$/, '');

	const endpoint = `${baseUrl}/audio/speech`;

	const abortController = new AbortController();
	const timer = setTimeout(() => abortController.abort(), timeoutMs);

	if (signal) {
		signal.addEventListener('abort', () => abortController.abort());
	}

	try {
		const response = await fetchFn(endpoint, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: 'tts-1',
				input: text,
				voice,
			}),
			signal: abortController.signal,
		});

		if (!response.ok) {
			const errBody = await response.text().catch(() => '');
			throw new CloudAudioError(
				`Cloud TTS failed with status ${response.status}: ${errBody || response.statusText}`,
				'HTTP_ERROR',
			);
		}

		const arrayBuffer = await response.arrayBuffer();
		writeFileSync(outputPath, Buffer.from(arrayBuffer));
	} catch (err) {
		if (err instanceof CloudAudioError) throw err;
		if (signal?.aborted || abortController.signal.aborted) {
			throw new CloudAudioError('Cloud TTS aborted', 'ABORTED');
		}
		throw new CloudAudioError(
			`Cloud TTS request failed: ${err instanceof Error ? err.message : String(err)}`,
			'NETWORK_ERROR',
		);
	} finally {
		clearTimeout(timer);
	}
}

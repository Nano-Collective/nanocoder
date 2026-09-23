import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'ava';
import {
	CloudAudioError,
	CloudAudioUnsupportedError,
	supportsCloudAudio,
	synthesizeCloudSpeech,
	transcribeCloudAudio,
} from './cloud-audio.js';
import type { AIProviderConfig } from '@/types/config';

test('supportsCloudAudio only detects verified OpenAI providers and fails closed for generic openai-compatible', t => {
	const openaiConfig: AIProviderConfig = {
		name: 'openai',
		sdkProvider: 'openai',
		models: ['gpt-4o'],
		config: { apiKey: 'sk-test' },
	};
	t.deepEqual(supportsCloudAudio(openaiConfig), { stt: true, tts: true });

	const openaiWithBaseUrlConfig: AIProviderConfig = {
		name: 'openai',
		sdkProvider: 'openai',
		models: ['gpt-4o'],
		config: { baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test' },
	};
	t.deepEqual(supportsCloudAudio(openaiWithBaseUrlConfig), { stt: true, tts: true });

	// Generic openai-compatible providers without confirmed /v1/audio endpoints must fail closed
	const ollamaConfig: AIProviderConfig = {
		name: 'ollama',
		sdkProvider: 'openai-compatible',
		models: ['llama3'],
		config: { baseURL: 'http://localhost:11434/v1' },
	};
	t.deepEqual(supportsCloudAudio(ollamaConfig), { stt: false, tts: false });

	const openrouterConfig: AIProviderConfig = {
		name: 'openrouter',
		sdkProvider: 'openai-compatible',
		models: ['meta-llama/llama-3-70b-instruct'],
		config: { baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-or' },
	};
	t.deepEqual(supportsCloudAudio(openrouterConfig), { stt: false, tts: false });

	const deceptiveHostConfig: AIProviderConfig = {
		name: 'openai',
		sdkProvider: 'openai',
		models: ['gpt-4o'],
		config: { baseURL: 'https://evil.example/api.openai.com/v1', apiKey: 'sk-test' },
	};
	t.deepEqual(supportsCloudAudio(deceptiveHostConfig), { stt: false, tts: false });

	const insecureOpenAIConfig: AIProviderConfig = {
		name: 'openai',
		sdkProvider: 'openai',
		models: ['gpt-4o'],
		config: { baseURL: 'http://api.openai.com/v1', apiKey: 'sk-test' },
	};
	t.deepEqual(supportsCloudAudio(insecureOpenAIConfig), { stt: false, tts: false });

	const anthropicConfig: AIProviderConfig = {
		name: 'anthropic',
		sdkProvider: 'anthropic',
		models: ['claude-3-5-sonnet-20241022'],
		config: { apiKey: 'sk-ant' },
	};
	t.deepEqual(supportsCloudAudio(anthropicConfig), { stt: false, tts: false });

	t.deepEqual(supportsCloudAudio(null), { stt: false, tts: false });
});

test('transcribeCloudAudio throws CloudAudioUnsupportedError for non-cloud providers', async t => {
	const anthropicConfig: AIProviderConfig = {
		name: 'anthropic',
		sdkProvider: 'anthropic',
		models: ['claude-3'],
		config: { apiKey: 'sk-ant' },
	};

	await t.throwsAsync(
		async () => {
			await transcribeCloudAudio('/tmp/fake.wav', {
				providerConfig: anthropicConfig,
			});
		},
		{ instanceOf: CloudAudioUnsupportedError },
	);
});

test('transcribeCloudAudio successfully posts to transcription endpoint and parses text', async t => {
	const tmpAudio = join(tmpdir(), `test-audio-${Date.now()}.wav`);
	writeFileSync(tmpAudio, Buffer.from('RIFF mock wav data'));

	const openaiConfig: AIProviderConfig = {
		name: 'openai',
		sdkProvider: 'openai',
		models: ['gpt-4o'],
		config: { apiKey: 'sk-test-key', baseURL: 'https://api.openai.com/v1' },
	};

	let capturedUrl = '';
	let capturedAuth = '';

	const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
		capturedUrl = String(url);
		capturedAuth = String(
			(init?.headers as Record<string, string>)?.Authorization,
		);
		return new Response(JSON.stringify({ text: 'transcribed speech from cloud' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}) as typeof fetch;

	try {
		const text = await transcribeCloudAudio(tmpAudio, {
			providerConfig: openaiConfig,
			fetchFn: mockFetch,
		});

		t.is(text, 'transcribed speech from cloud');
		t.is(capturedUrl, 'https://api.openai.com/v1/audio/transcriptions');
		t.is(capturedAuth, 'Bearer sk-test-key');
	} finally {
		if (existsSync(tmpAudio)) unlinkSync(tmpAudio);
	}
});

test('transcribeCloudAudio throws ABORTED error when AbortSignal triggers', async t => {
	const tmpAudio = join(tmpdir(), `test-audio-abort-${Date.now()}.wav`);
	writeFileSync(tmpAudio, Buffer.from('RIFF mock wav data'));

	const openaiConfig: AIProviderConfig = {
		name: 'openai',
		sdkProvider: 'openai',
		models: ['gpt-4o'],
		config: { apiKey: 'sk-test-key' },
	};

	const abortController = new AbortController();
	const mockSlowFetch = (async () => {
		abortController.abort();
		const err = new Error('The operation was aborted');
		err.name = 'AbortError';
		throw err;
	}) as typeof fetch;

	try {
		const err = await t.throwsAsync(
			async () => {
				await transcribeCloudAudio(tmpAudio, {
					providerConfig: openaiConfig,
					fetchFn: mockSlowFetch,
					signal: abortController.signal,
				});
			},
			{ instanceOf: CloudAudioError },
		);
		t.is((err as CloudAudioError).code, 'ABORTED');
	} finally {
		if (existsSync(tmpAudio)) unlinkSync(tmpAudio);
	}
});

test('synthesizeCloudSpeech successfully posts to speech endpoint and writes output file', async t => {
	const tmpOut = join(tmpdir(), `test-tts-out-${Date.now()}.wav`);

	const openaiConfig: AIProviderConfig = {
		name: 'openai',
		sdkProvider: 'openai',
		models: ['gpt-4o'],
		config: { apiKey: 'sk-test-key', baseURL: 'https://api.openai.com/v1' },
	};

	let capturedBody = '';

	const mockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
		capturedBody = String(init?.body);
		return new Response(Buffer.from('synthesized audio bytes'), {
			status: 200,
			headers: { 'Content-Type': 'audio/wav' },
		});
	}) as typeof fetch;

	try {
		await synthesizeCloudSpeech('hello world', tmpOut, {
			providerConfig: openaiConfig,
			voice: 'echo',
			fetchFn: mockFetch,
		});

		t.true(existsSync(tmpOut));
		t.true(capturedBody.includes('"voice":"echo"'));
	} finally {
		if (existsSync(tmpOut)) unlinkSync(tmpOut);
	}
});

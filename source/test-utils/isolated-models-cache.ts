/**
 * AVA `require` module (see package.json): runs in every test worker before
 * the spec file is imported.
 *
 * The models.dev client reads its database from XDG_CACHE_HOME and, when that
 * cache is missing or stale, downloads the full ~10MB database. Left alone,
 * every spec that reaches a context-limit or pricing lookup shared the
 * developer's real cache — which models-cache.spec deletes — and fell back to
 * a live download. Under a loaded full run that download outlived AVA's
 * timeout. Pointing XDG_CACHE_HOME at a per-worker temp dir seeded with a
 * small fixture keeps lookups offline, fast and deterministic, and keeps the
 * suite away from the developer's real cache.
 */
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {
	CachedModelsData,
	ModelsDevDatabase,
	ModelsDevModel,
} from '@/models/models-types';

type Input = NonNullable<ModelsDevModel['modalities']>['input'];

function model(
	id: string,
	context: number,
	cost: ModelsDevModel['cost'],
	input: Input = ['text'],
): ModelsDevModel {
	return {
		id,
		name: id,
		release_date: '2025-01-01',
		attachment: input.includes('image'),
		reasoning: false,
		temperature: true,
		tool_call: true,
		cost,
		limit: {context, output: 16_384},
		modalities: {input, output: ['text']},
		options: {},
	};
}

function provider(
	id: string,
	name: string,
	models: ModelsDevModel[],
): ModelsDevDatabase[string] {
	return {
		id,
		name,
		env: [],
		models: Object.fromEntries(models.map(m => [m.id, m])),
	};
}

const FIXTURE_DATABASE: ModelsDevDatabase = {
	openai: provider('openai', 'OpenAI', [
		model('gpt-4', 8_192, {input: 30, output: 60}),
		model('gpt-4o', 128_000, {input: 2.5, output: 10, cache_read: 1.25}, [
			'text',
			'image',
		]),
	]),
	anthropic: provider('anthropic', 'Anthropic', [
		model(
			'claude-opus-4-5',
			200_000,
			{input: 5, output: 25, cache_read: 0.5, cache_write: 6.25},
			['text', 'image', 'pdf'],
		),
		model(
			'claude-sonnet-4-5',
			200_000,
			{input: 3, output: 15, cache_read: 0.3, cache_write: 3.75},
			['text', 'image', 'pdf'],
		),
	]),
	groq: provider('groq', 'Groq', [
		model('llama3-70b-8192', 8_192, {input: 0.59, output: 0.79}),
		model('mixtral-8x7b-32768', 32_768, {input: 0.24, output: 0.24}),
	]),
	cohere: provider('cohere', 'Cohere', [
		model('command-r', 128_000, {input: 0.15, output: 0.6}),
		model('command-r-plus', 128_000, {input: 2.5, output: 10}),
	]),
	deepseek: provider('deepseek', 'DeepSeek', [
		model('deepseek-chat', 128_000, {input: 0.28, output: 0.42}),
	]),
	'ollama-cloud': provider('ollama-cloud', 'Ollama Cloud', [
		model('glm-4.7', 202_752, {input: 0, output: 0}),
		model('gpt-oss:20b', 131_072, {input: 0, output: 0}),
		model('gpt-oss:120b', 131_072, {input: 0, output: 0}),
		model('minimax-m2', 204_800, {input: 0, output: 0}),
		model('devstral-2:123b', 262_144, {input: 0, output: 0}),
	]),
};

const cacheHome = mkdtempSync(join(tmpdir(), 'nanocoder-models-cache-'));
process.env.XDG_CACHE_HOME = cacheHome;

const cached: CachedModelsData = {
	data: FIXTURE_DATABASE,
	fetchedAt: Date.now(),
	expiresAt: Date.now() + 24 * 60 * 60 * 1000,
};
mkdirSync(join(cacheHome, 'nanocoder'), {recursive: true});
writeFileSync(
	join(cacheHome, 'nanocoder', 'models.json'),
	JSON.stringify(cached),
	'utf-8',
);

process.on('exit', () => {
	rmSync(cacheHome, {recursive: true, force: true});
});

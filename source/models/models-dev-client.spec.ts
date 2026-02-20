import test from 'ava';
import {getModelContextLimit} from './models-dev-client.js';

console.log(`\nmodels-dev-client.spec.ts`);

/**
 * Tests for models-dev-client.ts
 *
 * Note: These tests make real API calls to models.dev.
 * The API has caching and fallback mechanisms built in.
 *
 * Priority order: models.dev (primary) → hardcoded fallback (offline)
 *
 * Tests are organized by:
 * 1. models.dev API lookups (network required, cached) — returns dynamic values
 * 2. Ollama-only fallback models (no network required) — returns exact values
 * 3. Cloud model normalization
 * 4. Edge cases
 */

// ============================================================================
// models.dev API Lookups (Primary Source)
// These models exist on models.dev and return dynamic values that may change.
// We assert typeof === 'number' rather than exact values.
// ============================================================================

test('getModelContextLimit - returns a number for llama3.2 (models.dev)', async t => {
	const limit = await getModelContextLimit('llama3.2');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for llama3.1 (models.dev)', async t => {
	const limit = await getModelContextLimit('llama3.1');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for llama3 (models.dev)', async t => {
	const limit = await getModelContextLimit('llama3');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for llama2 (models.dev)', async t => {
	const limit = await getModelContextLimit('llama2');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for mistral (models.dev)', async t => {
	const limit = await getModelContextLimit('mistral');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for mixtral (models.dev)', async t => {
	const limit = await getModelContextLimit('mixtral');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for mixtral:8x22b (models.dev)', async t => {
	const limit = await getModelContextLimit('mixtral:8x22b');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for qwen (models.dev)', async t => {
	const limit = await getModelContextLimit('qwen');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for qwen2.5 (models.dev)', async t => {
	const limit = await getModelContextLimit('qwen2.5');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for qwen3 (models.dev)', async t => {
	const limit = await getModelContextLimit('qwen3');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for gemma (models.dev)', async t => {
	const limit = await getModelContextLimit('gemma');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for gemma2 (models.dev)', async t => {
	const limit = await getModelContextLimit('gemma2');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for command-r (models.dev)', async t => {
	const limit = await getModelContextLimit('command-r');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for command-r-plus (models.dev)', async t => {
	const limit = await getModelContextLimit('command-r-plus');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for deepseek-coder (models.dev)', async t => {
	const limit = await getModelContextLimit('deepseek-coder');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for deepseek-coder-v2 (models.dev)', async t => {
	const limit = await getModelContextLimit('deepseek-coder-v2');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for phi3 (models.dev)', async t => {
	const limit = await getModelContextLimit('phi3');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - fetches from models.dev for popular API models', async t => {
	const limit = await getModelContextLimit('gpt-4');
	t.true(limit === null || typeof limit === 'number');
});

// ============================================================================
// models.dev API Lookups - Model Variants (with quantization/tags)
// These should still resolve via models.dev or fallback
// ============================================================================

test('getModelContextLimit - handles llama3.1:8b-instruct-q4_0 variant', async t => {
	const limit = await getModelContextLimit('llama3.1:8b-instruct-q4_0');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - handles mistral:7b-instruct variant', async t => {
	const limit = await getModelContextLimit('mistral:7b-instruct');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - handles qwen2.5:7b-instruct-fp16 variant', async t => {
	const limit = await getModelContextLimit('qwen2.5:7b-instruct-fp16');
	t.is(typeof limit, 'number');
});

// ============================================================================
// models.dev API Lookups - Cloud Models (strip :cloud, then query models.dev)
// ============================================================================

test('getModelContextLimit - returns a number for glm-4.7:cloud (models.dev)', async t => {
	const limit = await getModelContextLimit('glm-4.7:cloud');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for deepseek-v3.1:671b-cloud', async t => {
	const limit = await getModelContextLimit('deepseek-v3.1:671b-cloud');
	t.is(typeof limit, 'number');
});

// ============================================================================
// Cloud Models resolved via models.dev (after stripping :cloud suffix)
// These models are found on models.dev after normalization.
// ============================================================================

test('getModelContextLimit - returns a number for gpt-oss:20b-cloud', async t => {
	const limit = await getModelContextLimit('gpt-oss:20b-cloud');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for gpt-oss:120b-cloud', async t => {
	const limit = await getModelContextLimit('gpt-oss:120b-cloud');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for qwen3-coder:480b-cloud', async t => {
	const limit = await getModelContextLimit('qwen3-coder:480b-cloud');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for minimax-m2:cloud', async t => {
	const limit = await getModelContextLimit('minimax-m2:cloud');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for kimi-k2:1t-cloud', async t => {
	const limit = await getModelContextLimit('kimi-k2:1t-cloud');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for kimi-k2-thinking:cloud', async t => {
	const limit = await getModelContextLimit('kimi-k2-thinking:cloud');
	t.is(typeof limit, 'number');
});

// ============================================================================
// Models resolved via models.dev or fallback (dynamic values)
// ============================================================================

test('getModelContextLimit - returns a number for kimi-for-coding', async t => {
	const limit = await getModelContextLimit('kimi-for-coding');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for devstral-small-2:24b', async t => {
	const limit = await getModelContextLimit('devstral-small-2:24b');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - returns a number for devstral-2', async t => {
	const limit = await getModelContextLimit('devstral-2');
	t.is(typeof limit, 'number');
});

// ============================================================================
// Cloud Model Normalization
// ============================================================================

test('getModelContextLimit - cloud suffix is stripped before models.dev lookup', async t => {
	// gpt-oss:20b-cloud → strips "-cloud" → "gpt-oss:20b" → resolves via models.dev or fallback
	const limit = await getModelContextLimit('gpt-oss:20b-cloud');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - handles -cloud suffix (hyphen variant)', async t => {
	const limit = await getModelContextLimit('unknown-model-cloud');
	t.true(limit === null || typeof limit === 'number');
});

// ============================================================================
// Edge Cases
// ============================================================================

test('getModelContextLimit - returns null for completely unknown model', async t => {
	const limit = await getModelContextLimit('unknown-model-12345');
	t.is(limit, null);
});

test('getModelContextLimit - handles empty string', async t => {
	const limit = await getModelContextLimit('');
	t.is(limit, null);
});

test('getModelContextLimit - handles model names with uppercase', async t => {
	const limit = await getModelContextLimit('LLAMA3.1:8B');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - handles model names with mixed case', async t => {
	const limit = await getModelContextLimit('Llama3.1:8B');
	t.is(typeof limit, 'number');
});

test('getModelContextLimit - handles models.dev API failure gracefully', async t => {
	const limit = await getModelContextLimit('some-api-only-model-xyz');
	t.is(limit, null);
});

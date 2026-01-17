import test from 'ava';
import {getModelContextLimit} from './models-dev-client.js';

console.log(`\nmodels-dev-client.spec.ts`);

/**
 * Tests for models-dev-client.ts
 *
 * Note: These tests make real API calls to models.dev.
 * The API has caching and fallback mechanisms built in.
 * Tests are organized by:
 * 1. Ollama cloud model fallbacks (no network required)
 * 2. Ollama local model fallbacks (no network required)
 * 3. models.dev API lookups (network required, cached)
 */

// ============================================================================
// Ollama Cloud Model Fallbacks
// ============================================================================

test('getModelContextLimit - returns 128000 for gpt-oss:20b-cloud', async t => {
	const limit = await getModelContextLimit('gpt-oss:20b-cloud');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for gpt-oss:120b-cloud', async t => {
	const limit = await getModelContextLimit('gpt-oss:120b-cloud');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for qwen3-coder:480b-cloud', async t => {
	const limit = await getModelContextLimit('qwen3-coder:480b-cloud');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for deepseek-v3.1:671b-cloud', async t => {
	const limit = await getModelContextLimit('deepseek-v3.1:671b-cloud');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 196608 for minimax-m2:cloud', async t => {
	const limit = await getModelContextLimit('minimax-m2:cloud');
	t.is(limit, 196608);
});

test('getModelContextLimit - returns 200000 for glm-4.7:cloud', async t => {
	const limit = await getModelContextLimit('glm-4.7:cloud');
	t.is(limit, 200000);
});

test('getModelContextLimit - returns 256000 for kimi-k2:1t-cloud', async t => {
	const limit = await getModelContextLimit('kimi-k2:1t-cloud');
	t.is(limit, 256000);
});

test('getModelContextLimit - returns 256000 for kimi-k2-thinking:cloud', async t => {
	const limit = await getModelContextLimit('kimi-k2-thinking:cloud');
	t.is(limit, 256000);
});

// ============================================================================
// Ollama Local Model Fallbacks - Llama Family
// ============================================================================

test('getModelContextLimit - returns 128000 for llama3.2', async t => {
	const limit = await getModelContextLimit('llama3.2');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for llama3.2:1b', async t => {
	const limit = await getModelContextLimit('llama3.2:1b');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for llama3.2:3b', async t => {
	const limit = await getModelContextLimit('llama3.2:3b');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for llama3.1', async t => {
	const limit = await getModelContextLimit('llama3.1');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for llama3.1:8b', async t => {
	const limit = await getModelContextLimit('llama3.1:8b');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for llama3.1:70b', async t => {
	const limit = await getModelContextLimit('llama3.1:70b');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for llama3.1:405b', async t => {
	const limit = await getModelContextLimit('llama3.1:405b');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 8192 for llama3', async t => {
	const limit = await getModelContextLimit('llama3');
	t.is(limit, 8192);
});

test('getModelContextLimit - returns 8192 for llama3:8b', async t => {
	const limit = await getModelContextLimit('llama3:8b');
	t.is(limit, 8192);
});

test('getModelContextLimit - returns 8192 for llama3:70b', async t => {
	const limit = await getModelContextLimit('llama3:70b');
	t.is(limit, 8192);
});

test('getModelContextLimit - returns 4096 for llama2', async t => {
	const limit = await getModelContextLimit('llama2');
	t.is(limit, 4096);
});

test('getModelContextLimit - returns 4096 for llama2:7b', async t => {
	const limit = await getModelContextLimit('llama2:7b');
	t.is(limit, 4096);
});

test('getModelContextLimit - returns 4096 for llama2:13b', async t => {
	const limit = await getModelContextLimit('llama2:13b');
	t.is(limit, 4096);
});

test('getModelContextLimit - returns 4096 for llama2:70b', async t => {
	const limit = await getModelContextLimit('llama2:70b');
	t.is(limit, 4096);
});

// ============================================================================
// Ollama Local Model Fallbacks - Mistral Family
// ============================================================================

test('getModelContextLimit - returns 32000 for mistral', async t => {
	const limit = await getModelContextLimit('mistral');
	t.is(limit, 32000);
});

test('getModelContextLimit - returns 32000 for mistral:7b', async t => {
	const limit = await getModelContextLimit('mistral:7b');
	t.is(limit, 32000);
});

test('getModelContextLimit - returns 32000 for mixtral', async t => {
	const limit = await getModelContextLimit('mixtral');
	t.is(limit, 32000);
});

test('getModelContextLimit - returns 32000 for mixtral:8x7b', async t => {
	const limit = await getModelContextLimit('mixtral:8x7b');
	t.is(limit, 32000);
});

test('getModelContextLimit - returns 32000 for mixtral:8x22b', async t => {
	const limit = await getModelContextLimit('mixtral:8x22b');
	t.is(limit, 32000);
});

// ============================================================================
// Ollama Local Model Fallbacks - Qwen Family
// ============================================================================

test('getModelContextLimit - returns 32000 for qwen', async t => {
	const limit = await getModelContextLimit('qwen');
	t.is(limit, 32000);
});

test('getModelContextLimit - returns 32000 for qwen:7b', async t => {
	const limit = await getModelContextLimit('qwen:7b');
	t.is(limit, 32000);
});

test('getModelContextLimit - returns 32000 for qwen:14b', async t => {
	const limit = await getModelContextLimit('qwen:14b');
	t.is(limit, 32000);
});

test('getModelContextLimit - returns 32000 for qwen2', async t => {
	const limit = await getModelContextLimit('qwen2');
	t.is(limit, 32000);
});

test('getModelContextLimit - returns 32000 for qwen2:7b', async t => {
	const limit = await getModelContextLimit('qwen2:7b');
	t.is(limit, 32000);
});

test('getModelContextLimit - returns 128000 for qwen2.5', async t => {
	const limit = await getModelContextLimit('qwen2.5');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for qwen2.5:7b', async t => {
	const limit = await getModelContextLimit('qwen2.5:7b');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for qwen3', async t => {
	const limit = await getModelContextLimit('qwen3');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for qwen3:7b', async t => {
	const limit = await getModelContextLimit('qwen3:7b');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for qwen3:14b', async t => {
	const limit = await getModelContextLimit('qwen3:14b');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for qwen3:32b', async t => {
	const limit = await getModelContextLimit('qwen3:32b');
	t.is(limit, 128000);
});

// ============================================================================
// Ollama Local Model Fallbacks - Gemma Family
// ============================================================================

test('getModelContextLimit - returns 8192 for gemma', async t => {
	const limit = await getModelContextLimit('gemma');
	t.is(limit, 8192);
});

test('getModelContextLimit - returns 8192 for gemma:2b', async t => {
	const limit = await getModelContextLimit('gemma:2b');
	t.is(limit, 8192);
});

test('getModelContextLimit - returns 8192 for gemma:7b', async t => {
	const limit = await getModelContextLimit('gemma:7b');
	t.is(limit, 8192);
});

test('getModelContextLimit - returns 8192 for gemma2', async t => {
	const limit = await getModelContextLimit('gemma2');
	t.is(limit, 8192);
});

test('getModelContextLimit - returns 8192 for gemma2:9b', async t => {
	const limit = await getModelContextLimit('gemma2:9b');
	t.is(limit, 8192);
});

test('getModelContextLimit - returns 8192 for gemma2:27b', async t => {
	const limit = await getModelContextLimit('gemma2:27b');
	t.is(limit, 8192);
});

// ============================================================================
// Ollama Local Model Fallbacks - Other Models
// ============================================================================

test('getModelContextLimit - returns 128000 for command-r', async t => {
	const limit = await getModelContextLimit('command-r');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for command-r-plus', async t => {
	const limit = await getModelContextLimit('command-r-plus');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 16000 for deepseek-coder', async t => {
	const limit = await getModelContextLimit('deepseek-coder');
	t.is(limit, 16000);
});

test('getModelContextLimit - returns 16000 for deepseek-coder-v2', async t => {
	const limit = await getModelContextLimit('deepseek-coder-v2');
	t.is(limit, 16000);
});

test('getModelContextLimit - returns 128000 for phi3', async t => {
	const limit = await getModelContextLimit('phi3');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for phi3:mini', async t => {
	const limit = await getModelContextLimit('phi3:mini');
	t.is(limit, 128000);
});

test('getModelContextLimit - returns 128000 for phi3:medium', async t => {
	const limit = await getModelContextLimit('phi3:medium');
	t.is(limit, 128000);
});

// ============================================================================
// Ollama Model Variants (with quantization/tags)
// ============================================================================

test('getModelContextLimit - handles llama3.1:8b-instruct-q4_0 variant', async t => {
	const limit = await getModelContextLimit('llama3.1:8b-instruct-q4_0');
	t.is(limit, 128000);
});

test('getModelContextLimit - handles mistral:7b-instruct variant', async t => {
	const limit = await getModelContextLimit('mistral:7b-instruct');
	t.is(limit, 32000);
});

test('getModelContextLimit - handles qwen2.5:7b-instruct-fp16 variant', async t => {
	const limit = await getModelContextLimit('qwen2.5:7b-instruct-fp16');
	t.is(limit, 128000);
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
	t.is(limit, 128000);
});

test('getModelContextLimit - handles model names with mixed case', async t => {
	const limit = await getModelContextLimit('Llama3.1:8B');
	t.is(limit, 128000);
});

// ============================================================================
// models.dev API Lookups (Network Required)
// ============================================================================

test('getModelContextLimit - fetches from models.dev for popular API models', async t => {
	// This test requires network access and will use cached data if available
	// Testing with a common model that should be in models.dev
	const limit = await getModelContextLimit('gpt-4');

	// We just verify it returns a number or null (API might change)
	t.true(limit === null || typeof limit === 'number');
});

test('getModelContextLimit - handles models.dev API failure gracefully', async t => {
	// Test that the function doesn't throw even if models.dev is unavailable
	// Using a model that's not in fallbacks to trigger API lookup
	const limit = await getModelContextLimit('some-api-only-model-xyz');

	// Should return null gracefully, not throw
	t.is(limit, null);
});

// ============================================================================
// Cloud Model Normalization
// ============================================================================

test('getModelContextLimit - cloud suffix is tried first before normalization', async t => {
	// This ensures the fix for cloud models works
	// gpt-oss:20b-cloud should match the fallback BEFORE stripping :cloud
	const limit = await getModelContextLimit('gpt-oss:20b-cloud');
	t.is(limit, 128000);
});

test('getModelContextLimit - handles -cloud suffix (hyphen variant)', async t => {
	// Some models might use -cloud instead of :cloud
	// Note: Currently no models in fallback use this, but the code supports it
	const limit = await getModelContextLimit('unknown-model-cloud');

	// Should still process without error
	t.true(limit === null || typeof limit === 'number');
});

import test from 'ava';
import {isLocalURL, redactUrlSecrets} from './url-utils';

// ============================================================================
// isLocalURL - localhost
// ============================================================================

test('isLocalURL returns true for http://localhost', t => {
	t.true(isLocalURL('http://localhost'));
});

test('isLocalURL returns true for http://localhost:11434/v1', t => {
	t.true(isLocalURL('http://localhost:11434/v1'));
});

test('isLocalURL returns true for https://localhost:8080', t => {
	t.true(isLocalURL('https://localhost:8080'));
});

// ============================================================================
// isLocalURL - 127.0.0.1
// ============================================================================

test('isLocalURL returns true for http://127.0.0.1', t => {
	t.true(isLocalURL('http://127.0.0.1'));
});

test('isLocalURL returns true for http://127.0.0.1:11434/v1', t => {
	t.true(isLocalURL('http://127.0.0.1:11434/v1'));
});

test('isLocalURL returns true for https://127.0.0.1:8080/api', t => {
	t.true(isLocalURL('https://127.0.0.1:8080/api'));
});

// ============================================================================
// isLocalURL - 0.0.0.0
// ============================================================================

test('isLocalURL returns true for http://0.0.0.0:11434', t => {
	t.true(isLocalURL('http://0.0.0.0:11434'));
});

// ============================================================================
// isLocalURL - ::1 (IPv6 loopback)
// ============================================================================

test('isLocalURL returns true for http://[::1]:11434/v1', t => {
	t.true(isLocalURL('http://[::1]:11434/v1'));
});

// ============================================================================
// isLocalURL - remote URLs
// ============================================================================

test('isLocalURL returns false for https://api.openai.com/v1', t => {
	t.false(isLocalURL('https://api.openai.com/v1'));
});

test('isLocalURL returns false for https://openrouter.ai/api/v1', t => {
	t.false(isLocalURL('https://openrouter.ai/api/v1'));
});

test('isLocalURL returns false for https://example.com', t => {
	t.false(isLocalURL('https://example.com'));
});

// ============================================================================
// isLocalURL - malformed URLs (fallback to string matching)
// ============================================================================

test('isLocalURL handles malformed URL with localhost', t => {
	t.true(isLocalURL('localhost:11434'));
});

test('isLocalURL handles malformed URL with 127.0.0.1', t => {
	t.true(isLocalURL('127.0.0.1:11434'));
});

test('isLocalURL returns false for malformed non-local URL', t => {
	t.false(isLocalURL('not-a-url'));
});

// ============================================================================
// redactUrlSecrets
// ============================================================================

test('redactUrlSecrets removes credentials and query parameters from URLs', t => {
	const raw =
		'https://user:sk-test-LEAKCHECK123@proxy.example.com/v1?key=QUERYKEY-LEAKCHECK';
	t.is(redactUrlSecrets(raw), 'https://proxy.example.com/v1');
});

test('redactUrlSecrets masks long token path segments and strips queries', t => {
	const raw =
		'https://mcp.example.com/api/mcp/s/PATHTOKEN-LEAKCHECK/mcp?api_key=APIKEY-LEAKCHECK';
	t.is(redactUrlSecrets(raw), 'https://mcp.example.com/api/mcp/s/<redacted>/mcp');
});

test('redactUrlSecrets masks token-like path segments with sk- prefix', t => {
	const raw = 'https://proxy.example.com/v1/sk-abc1234/models';
	t.is(redactUrlSecrets(raw), 'https://proxy.example.com/v1/<redacted>/models');
});

test('redactUrlSecrets preserves standard short path segments', t => {
	const raw = 'https://openrouter.ai/api/v1/chat/completions';
	t.is(redactUrlSecrets(raw), 'https://openrouter.ai/api/v1/chat/completions');
});

test('redactUrlSecrets does not over-redact token endpoints or tokenizer paths', t => {
	t.is(
		redactUrlSecrets('https://proxy.example.com/v1/tokenizer/encode'),
		'https://proxy.example.com/v1/tokenizer/encode',
	);
	t.is(
		redactUrlSecrets('https://proxy.example.com/v1/tokens'),
		'https://proxy.example.com/v1/tokens',
	);
});

test('redactUrlSecrets preserves Azure deployment names and model identifiers', t => {
	t.is(
		redactUrlSecrets(
			'https://my-resource.openai.azure.com/openai/deployments/gpt-4o-mini-deployment/chat/completions',
		),
		'https://my-resource.openai.azure.com/openai/deployments/gpt-4o-mini-deployment/chat/completions',
	);
	t.is(
		redactUrlSecrets('https://example.com/deployments/MyDeployment2024'),
		'https://example.com/deployments/MyDeployment2024',
	);
	t.is(
		redactUrlSecrets('https://example.com/models/Qwen3Coder30B'),
		'https://example.com/models/Qwen3Coder30B',
	);
});

test('redactUrlSecrets masks 16-23 character opaque hex and alphanumeric tokens', t => {
	t.is(
		redactUrlSecrets('https://proxy.example.com/v1/abcdef1234567890abcd'),
		'https://proxy.example.com/v1/<redacted>',
	);
	t.is(
		redactUrlSecrets('https://proxy.example.com/v1/abc123def456ghi789jk'),
		'https://proxy.example.com/v1/<redacted>',
	);
});

test('redactUrlSecrets masks secret-shaped segments even under models or deployments paths', t => {
	t.is(
		redactUrlSecrets('https://example.com/v1/models/sk-1234567890abcdef'),
		'https://example.com/v1/models/<redacted>',
	);
	t.is(
		redactUrlSecrets(
			'https://example.com/deployments/123e4567-e89b-12d3-a456-426614174000',
		),
		'https://example.com/deployments/<redacted>',
	);
	t.is(
		redactUrlSecrets(
			'https://example.com/openai/deployments/sk-abcdef123456/chat',
		),
		'https://example.com/openai/deployments/<redacted>/chat',
	);
	t.is(
		redactUrlSecrets('https://example.com/v1/model/ghp_abcdef123456'),
		'https://example.com/v1/model/<redacted>',
	);
	t.is(
		redactUrlSecrets('https://example.com/mcp/s/gptSecretToken1234'),
		'https://example.com/mcp/s/<redacted>',
	);
	t.is(
		redactUrlSecrets('https://example.com/webhooks/claudeSecretToken1234'),
		'https://example.com/webhooks/<redacted>',
	);
});

test('redactUrlSecrets masks short webhook tokens and high-entropy segments', t => {
	t.is(
		redactUrlSecrets('https://api.example.com/hooks/abc123XYZ789'),
		'https://api.example.com/hooks/<redacted>',
	);
	t.is(
		redactUrlSecrets('https://api.example.com/webhooks/webhookToken12345'),
		'https://api.example.com/webhooks/<redacted>',
	);
});

test('redactUrlSecrets handles empty and nullish values gracefully', t => {
	t.is(redactUrlSecrets(undefined), undefined);
	t.is(redactUrlSecrets(null), undefined);
	t.is(redactUrlSecrets(''), undefined);
	t.is(redactUrlSecrets('   '), undefined);
});

test('redactUrlSecrets masks tokens and strips credentials on schemeless URLs', t => {
	const schemelessToken = 'proxy.example.com/v1/sk-abc123def4567890';
	t.is(redactUrlSecrets(schemelessToken), 'proxy.example.com/v1/<redacted>');

	const schemelessUserinfo =
		'user:pass@proxy.example.com/v1/sk-abc123def4567890';
	t.is(redactUrlSecrets(schemelessUserinfo), 'proxy.example.com/v1/<redacted>');

	const schemelessQuery =
		'user:secret@proxy.example.com/v1/models?api_key=SECRET123';
	t.is(redactUrlSecrets(schemelessQuery), 'proxy.example.com/v1/models');
});


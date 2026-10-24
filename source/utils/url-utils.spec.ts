import test from 'ava';
import {isLocalURL, redactSecretsInURL} from './url-utils';

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
// redactSecretsInURL - userinfo
// ============================================================================

test('redactSecretsInURL redacts userinfo password', t => {
	t.is(
		redactSecretsInURL('https://user:sk-test-LEAKCHECK123@proxy.example.com/v1?key=QUERYKEY-LEAKCHECK'),
		'https://REDACTED:REDACTED@proxy.example.com/v1?key=REDACTED',
	);
});

test('redactSecretsInURL redacts userinfo without password', t => {
	t.is(
		redactSecretsInURL('https://token123@proxy.example.com/v1'),
		'https://REDACTED@proxy.example.com/v1',
	);
});

// ============================================================================
// redactSecretsInURL - query credentials
// ============================================================================

test('redactSecretsInURL redacts api_key query parameter', t => {
	t.is(
		redactSecretsInURL('https://api.example.com/v1?api_key=SECRET123&model=gpt-4'),
		'https://api.example.com/v1?api_key=REDACTED&model=gpt-4',
	);
});

test('redactSecretsInURL redacts token query parameter case-insensitively', t => {
	t.is(
		redactSecretsInURL('https://api.example.com/v1?AccessToken=SECRET123'),
		'https://api.example.com/v1?AccessToken=REDACTED',
	);
});

// ============================================================================
// redactSecretsInURL - path tokens
// ============================================================================

test('redactSecretsInURL redacts path token after marker segment', t => {
	t.is(
		redactSecretsInURL('https://mcp.example.com/api/mcp/s/PATHTOKEN-LEAKCHECK/mcp?api_key=APIKEY-LEAKCHECK'),
		'https://mcp.example.com/api/mcp/s/REDACTED/mcp?api_key=REDACTED',
	);
});

// ============================================================================
// redactSecretsInURL - non-secret URLs are preserved
// ============================================================================

test('redactSecretsInURL keeps a clean URL unchanged', t => {
	t.is(
		redactSecretsInURL('https://api.openai.com/v1'),
		'https://api.openai.com/v1',
	);
});

test('redactSecretsInURL keeps ordinary path segments', t => {
	t.is(
		redactSecretsInURL('https://api.example.com/v1/models/gpt-4'),
		'https://api.example.com/v1/models/gpt-4',
	);
});

// ============================================================================
// redactSecretsInURL - malformed URLs
// ============================================================================

test('redactSecretsInURL redacts userinfo in malformed URL', t => {
	t.is(
		redactSecretsInURL('https://user:pass@not a url'),
		'https://REDACTED@not a url',
	);
});

test('redactSecretsInURL passes through empty string', t => {
	t.is(redactSecretsInURL(''), '');
});

// ============================================================================
// redactSecretsInURL - short marker segments only apply mid-path
// ============================================================================

test('redactSecretsInURL keeps a resource named after a short marker segment', t => {
	// `/s/settings` and `/t/translation` name real resources: a single-character
	// marker only introduces a token when the path continues past it.
	t.is(
		redactSecretsInURL('https://api.example.com/s/settings'),
		'https://api.example.com/s/settings',
	);
	t.is(
		redactSecretsInURL('https://api.example.com/t/translation'),
		'https://api.example.com/t/translation',
	);
});

test('redactSecretsInURL still redacts a short-marker path that continues', t => {
	t.is(
		redactSecretsInURL('https://mcp.example.com/api/mcp/s/abc123def456/mcp'),
		'https://mcp.example.com/api/mcp/s/REDACTED/mcp',
	);
});

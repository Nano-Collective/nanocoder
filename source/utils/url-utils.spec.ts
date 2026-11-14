import test from 'ava';
import {isLocalURL} from './url-utils';

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

for (const host of [
	'127.0.0.2',
	'127.255.255.254',
	'192.168.1.50',
	'10.0.0.5',
	'172.16.0.1',
	'172.31.255.254',
	'169.254.1.1',
	'100.64.0.1',
	'100.127.255.254',
	'[::ffff:127.0.0.1]',
	'[::ffff:192.168.1.50]',
	'[fc00::1]',
	'[fd12::1]',
	'[fe80::1]',
	'[febf::1]',
	'host.docker.internal',
	'ollama',
	'gpu-box.local',
	'foo.localhost',
	'localhost.',
	'GPU-BOX.LOCAL.',
]) {
	test(`isLocalURL recognizes self-hosted provider ${host}`, t => {
		t.true(isLocalURL(`http://${host}:11434/v1`));
	});
}

for (const host of [
	'172.15.255.255',
	'172.32.0.0',
	'100.63.255.255',
	'100.128.0.0',
	'169.253.1.1',
	'192.169.1.1',
	'8.8.8.8',
	'[::ffff:8.8.8.8]',
	'[2001:4860:4860::8888]',
	'[fe7f::1]',
	'[fec0::1]',
	'localhost.example.com',
	'gpu-box.local.example.com',
	'host.docker.internal.example.com',
]) {
	test(`isLocalURL keeps public provider ${host} remote`, t => {
		t.false(isLocalURL(`http://${host}:11434/v1`));
	});
}

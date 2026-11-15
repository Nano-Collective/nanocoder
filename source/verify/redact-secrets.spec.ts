import test from 'ava';
import {redactSecrets} from './redact-secrets';

console.log('\nredact-secrets.spec.ts');

const EMPTY_ENV = {};

test('redacts common token shapes', t => {
	const samples = [
		'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
		'gho_abcdefghijklmnopqrstuvwxyz0123456789',
		'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
		'sk-abcdefghijklmnopqrstuvwx',
		'sk-ant-api03-abcdefghijklmnopqrstuvwx',
		'AKIAIOSFODNN7EXAMPLE',
		'xoxb-1234567890-abcdefghij',
		'xoxp-1234567890-abcdefghij',
	];
	for (const secret of samples) {
		const out = redactSecrets(`before ${secret} after`, EMPTY_ENV);
		t.is(out, 'before [REDACTED] after', secret);
	}
});

test('redacts Google, GitLab, Stripe, Slack and JWT token shapes', t => {
	const samples = [
		'AIzaSyD-abcdefghijklmnopqrstuvwxyz01234',
		'glpat-abcdefghij0123456789',
		'gldt-abcdefghij0123456789xy',
		'sk_live_abcdefghijklmnop0123',
		'rk_live_abcdefghijklmnop0123',
		'sk_test_abcdefghijklmnop0123',
		'xoxa-1234567890-abcdefghij',
		'xoxr-1234567890-abcdefghij',
		'xoxs-1234567890-abcdefghij',
		'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
	];
	for (const secret of samples) {
		const out = redactSecrets(`before ${secret} after`, EMPTY_ENV);
		t.is(out, 'before [REDACTED] after', secret);
	}
});

test('new token shapes leave ordinary code alone', t => {
	const text = [
		// Identifiers that merely contain a prefix.
		'const risk_live_window = desk_test_mode;',
		'function AIzaHelper() { return glpatch; }',
		// Too short to be a Google key.
		'const key = "AIzaShort";',
		// A dotted name starting with eyJ but without three long segments.
		'eyJ.foo.bar',
		'import {eyJunk} from "./x";',
	].join('\n');
	t.is(redactSecrets(text, EMPTY_ENV), text);
});

test('redacts a PEM private key block', t => {
	const key = [
		'-----BEGIN OPENSSH PRIVATE KEY-----',
		'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ',
		'-----END OPENSSH PRIVATE KEY-----',
	].join('\n');
	t.is(redactSecrets(`x\n${key}\ny`, EMPTY_ENV), 'x\n[REDACTED]\ny');
});

test('redacts values of secret-looking env vars of length >= 8', t => {
	const env = {
		MY_API_KEY: 'hunter2hunter2',
		DB_PASSWORD: 'correct-horse',
		SHORT_TOKEN: 'abc',
		HOME: '/home/someone',
	};
	const out = redactSecrets(
		'key hunter2hunter2, pw correct-horse, short abc, home /home/someone',
		env,
	);
	t.is(
		out,
		'key [REDACTED], pw [REDACTED], short abc, home /home/someone',
	);
});

test('escapes regex metacharacters in env values', t => {
	const env = {CLIENT_SECRET: 'a.b*c+d(e)'};
	t.is(redactSecrets('v=a.b*c+d(e) and axbbbcd', env), 'v=[REDACTED] and axbbbcd');
});

test('leaves ordinary text alone', t => {
	const text = '### Summary\nThe test `sk-foo` failed at src/a.ts:12 (task-key).';
	t.is(redactSecrets(text, EMPTY_ENV), text);
});

test('redacts extra literal values, longest first with env values', t => {
	const env = {MY_API_KEY: 'abcdefgh'};
	t.is(
		redactSecrets('k=config-key-abcdefgh-123 e=abcdefgh', env, [
			'config-key-abcdefgh-123',
		]),
		'k=[REDACTED] e=[REDACTED]',
	);
});

test('ignores extra literal values shorter than 8 characters', t => {
	t.is(redactSecrets('the abc test', EMPTY_ENV, ['abc', '']), 'the abc test');
});

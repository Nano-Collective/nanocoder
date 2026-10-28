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

test('treats regex metacharacters in env values as literal text', t => {
	const env = {CLIENT_SECRET: 'a.b*c+d(e)'};
	t.is(redactSecrets('v=a.b*c+d(e) and axbbbcd', env), 'v=[REDACTED] and axbbbcd');
});

test('leaves ordinary text alone', t => {
	const text = '### Summary\nThe test `sk-foo` failed at src/a.ts:12 (task-key).';
	t.is(redactSecrets(text, EMPTY_ENV), text);
});

test('redacts every occurrence of an env value', t => {
	const env = {API_TOKEN: 'hunter2hunter2'};
	t.is(
		redactSecrets('a hunter2hunter2 b hunter2hunter2', env),
		'a [REDACTED] b [REDACTED]',
	);
});

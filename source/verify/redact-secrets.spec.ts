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

test('redacts Bearer, npm, Hugging Face, Twilio and SendGrid tokens', t => {
	const cases: Array<[string, string]> = [
		[
			'Authorization: Bearer abcdef0123456789abcdef0123456789',
			'Authorization: Bearer [REDACTED]',
		],
		[
			'token npm_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8',
			'token [REDACTED]',
		],
		[
			'token hf_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
			'token [REDACTED]',
		],
		['key SK0123456789abcdef0123456789abcdef', 'key [REDACTED]'],
		[
			'SG.abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
			'[REDACTED]',
		],
	];
	for (const [input, expected] of cases) {
		t.is(redactSecrets(input, EMPTY_ENV), expected, input);
	}
});

test('redacts AWS and Azure keys while keeping the field name', t => {
	t.is(
		redactSecrets(
			'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
			EMPTY_ENV,
		),
		'aws_secret_access_key = [REDACTED]',
	);
	t.is(
		redactSecrets(
			'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==',
			EMPTY_ENV,
		),
		'AccountKey=[REDACTED]',
	);
});

test('redacts only the password component of a URL', t => {
	const cases: Array<[string, string]> = [
		[
			'DATABASE_URL=postgres://admin:S3cretPassw0rd@db.internal:5432/app',
			'DATABASE_URL=postgres://admin:[REDACTED]@db.internal:5432/app',
		],
		[
			'git clone https://deploy:ghx-S3cretToken99@example.com/org/repo.git',
			'git clone https://deploy:[REDACTED]@example.com/org/repo.git',
		],
		// Password may itself contain @ or /; mask up to the last @ before the host.
		['postgres://admin:p@ss@db/x', 'postgres://admin:[REDACTED]@db/x'],
		['postgres://admin:ab/cd123@db', 'postgres://admin:[REDACTED]@db'],
		[
			'https://u:p@ss/wd@host:8443/path?q=1#frag',
			'https://u:[REDACTED]@host:8443/path?q=1#frag',
		],
	];
	for (const [input, expected] of cases) {
		t.is(redactSecrets(input, EMPTY_ENV), expected, input);
	}
});

test('redacts PASS and CREDENTIAL env values', t => {
	const env = {DB_PASS: 'hunter2hunter2'};
	t.is(
		redactSecrets(
			'env DB_PASS=hunter2hunter2, then the text "connecting with hunter2hunter2"',
			env,
		),
		'env DB_PASS=[REDACTED], then the text "connecting with [REDACTED]"',
	);
	const credEnv = {API_CREDENTIAL: 'abcdefgh1234'};
	t.is(
		redactSecrets('API_CREDENTIAL=abcdefgh1234', credEnv),
		'API_CREDENTIAL=[REDACTED]',
	);
});

test('PWD does not mask file paths, and AUTH does not mask non-secret values', t => {
	// Every shell sets PWD to the current directory; redactSecrets defaults to
	// process.env, so PWD must stay out of SECRET_ENV_NAME or all paths break.
	const pwdEnv = {PWD: '/home/runner/work/nanocoder/nanocoder'};
	t.is(
		redactSecrets(
			'see /home/runner/work/nanocoder/nanocoder/source/x.ts in the report',
			pwdEnv,
		),
		'see /home/runner/work/nanocoder/nanocoder/source/x.ts in the report',
	);
	// AUTH_URL and AUTH_TYPE are configuration, not credentials.
	const authEnv = {AUTH_URL: 'https://example.com', AUTH_TYPE: 'basic'};
	t.is(
		redactSecrets('AUTH_URL=https://example.com and AUTH_TYPE=basic', authEnv),
		'AUTH_URL=https://example.com and AUTH_TYPE=basic',
	);
});

test('new patterns leave ordinary text, identifiers and URLs alone', t => {
	const text = [
		'AUTHOR=Jane Doe, PASSAGE=well-known text, CREDENTIALS_REPORT=draft',
		'const bearerToken = config.read(); // no credential here',
		'https://example.com/org/repo without any credentials',
		'postgres://admin@db.internal:5432/app',
		'npm install did not fail; hf_models are loaded lazily',
		'Bearer authentication scheme is described here',
		'Bearer abcdefghijklmnop is prose here',
		'Warning: Bearer',
		'ordinary text continues here for a while',
	].join('\n');
	t.is(redactSecrets(text, EMPTY_ENV), text);
});

test('new env-name additions do not mask lookalike names', t => {
	const env = {
		AUTHOR: 'Jane Doe, writer of many books',
		PASSAGE: 'the quick brown fox jumps over the lazy dog',
		AUTHORS_NOTE: 'an ordinary note about the project',
	};
	const text = Object.entries(env)
		.map(([name, value]) => `${name}=${value}`)
		.join(' | ');
	t.is(redactSecrets(text, env), text);
});

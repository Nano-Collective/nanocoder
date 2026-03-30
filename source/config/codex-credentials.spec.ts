import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'ava';
import type {CodexTokens} from '@/auth/chatgpt-codex';
import {
	getCodexNoCredentialsMessage,
	loadCodexCredential,
	removeCodexCredential,
	saveCodexCredential,
	updateCodexCredential,
} from './codex-credentials';

let testConfigDir: string;
let originalConfigDir: string | undefined;

test.before(() => {
	testConfigDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'nanocoder-codex-credentials-'),
	);
	originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = testConfigDir;
});

test.afterEach(() => {
	// Clean up credentials file between tests
	const credPath = path.join(testConfigDir, 'codex-credentials.json');
	if (fs.existsSync(credPath)) {
		fs.unlinkSync(credPath);
	}
});

test.after.always(() => {
	if (testConfigDir && fs.existsSync(testConfigDir)) {
		fs.rmSync(testConfigDir, {recursive: true, force: true});
	}
	if (originalConfigDir !== undefined) {
		process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
	} else {
		delete process.env.NANOCODER_CONFIG_DIR;
	}
});

test.serial('loadCodexCredential returns null when no file exists', t => {
	const result = loadCodexCredential('ChatGPT');
	t.is(result, null);
});

test.serial('saveCodexCredential and loadCodexCredential round-trip', t => {
	const tokens: CodexTokens = {
		accessToken: 'test-access',
		refreshToken: 'test-refresh',
		expiresAt: 1234567890,
		accountId: 'acc-123',
	};

	saveCodexCredential('ChatGPT', tokens);
	const loaded = loadCodexCredential('ChatGPT');

	t.truthy(loaded);
	t.is(loaded!.accessToken, 'test-access');
	t.is(loaded!.refreshToken, 'test-refresh');
	t.is(loaded!.expiresAt, 1234567890);
	t.is(loaded!.accountId, 'acc-123');
});

test.serial('saveCodexCredential sets file permissions to 0o600', t => {
	const tokens: CodexTokens = {
		accessToken: 'perm-test',
		refreshToken: undefined,
		expiresAt: undefined,
		accountId: undefined,
	};

	saveCodexCredential('ChatGPT', tokens);
	const credPath = path.join(testConfigDir, 'codex-credentials.json');
	const stats = fs.statSync(credPath);
	const mode = stats.mode & 0o777;
	t.is(mode, 0o600);
});

test.serial('loadCodexCredential returns null for missing provider', t => {
	const tokens: CodexTokens = {
		accessToken: 'test-access',
		refreshToken: undefined,
		expiresAt: undefined,
		accountId: undefined,
	};

	saveCodexCredential('ChatGPT', tokens);
	const result = loadCodexCredential('NonExistent');
	t.is(result, null);
});

test.serial(
	'loadCodexCredential handles optional fields being undefined',
	t => {
		const tokens: CodexTokens = {
			accessToken: 'minimal',
			refreshToken: undefined,
			expiresAt: undefined,
			accountId: undefined,
		};

		saveCodexCredential('ChatGPT', tokens);
		const loaded = loadCodexCredential('ChatGPT');

		t.truthy(loaded);
		t.is(loaded!.accessToken, 'minimal');
		t.is(loaded!.refreshToken, undefined);
		t.is(loaded!.expiresAt, undefined);
		t.is(loaded!.accountId, undefined);
	},
);

test.serial(
	'updateCodexCredential updates specific fields only',
	t => {
		const tokens: CodexTokens = {
			accessToken: 'original-access',
			refreshToken: 'original-refresh',
			expiresAt: 1000,
			accountId: 'acc-1',
		};

		saveCodexCredential('ChatGPT', tokens);
		updateCodexCredential('ChatGPT', {
			accessToken: 'updated-access',
			expiresAt: 2000,
		});

		const loaded = loadCodexCredential('ChatGPT');
		t.truthy(loaded);
		t.is(loaded!.accessToken, 'updated-access');
		t.is(loaded!.refreshToken, 'original-refresh');
		t.is(loaded!.expiresAt, 2000);
		t.is(loaded!.accountId, 'acc-1');
	},
);

test.serial(
	'updateCodexCredential does nothing for non-existent provider',
	t => {
		updateCodexCredential('NonExistent', {accessToken: 'x'});
		const result = loadCodexCredential('NonExistent');
		t.is(result, null);
	},
);

test.serial('removeCodexCredential removes stored credential', t => {
	const tokens: CodexTokens = {
		accessToken: 'to-remove',
		refreshToken: undefined,
		expiresAt: undefined,
		accountId: undefined,
	};

	saveCodexCredential('ChatGPT', tokens);
	t.truthy(loadCodexCredential('ChatGPT'));

	removeCodexCredential('ChatGPT');
	t.is(loadCodexCredential('ChatGPT'), null);
});

test.serial(
	'removeCodexCredential is safe for non-existent provider',
	t => {
		// Should not throw
		removeCodexCredential('NonExistent');
		t.pass();
	},
);

test.serial(
	'multiple providers can be stored independently',
	t => {
		saveCodexCredential('ChatGPT', {
			accessToken: 'tok-1',
			refreshToken: undefined,
			expiresAt: undefined,
			accountId: undefined,
		});
		saveCodexCredential('Codex Pro', {
			accessToken: 'tok-2',
			refreshToken: 'ref-2',
			expiresAt: 9999,
			accountId: 'acc-2',
		});

		const c1 = loadCodexCredential('ChatGPT');
		const c2 = loadCodexCredential('Codex Pro');

		t.is(c1!.accessToken, 'tok-1');
		t.is(c2!.accessToken, 'tok-2');
		t.is(c2!.refreshToken, 'ref-2');
	},
);

test('getCodexNoCredentialsMessage includes provider name', t => {
	const msg = getCodexNoCredentialsMessage('MyProvider');
	t.truthy(msg.includes('MyProvider'));
	t.truthy(msg.includes('/codex-login'));
});

test('loadCodexCredential handles corrupt JSON gracefully', t => {
	const credPath = path.join(testConfigDir, 'codex-credentials.json');
	fs.writeFileSync(credPath, 'not-valid-json', {encoding: 'utf-8'});
	const result = loadCodexCredential('ChatGPT');
	t.is(result, null);
});

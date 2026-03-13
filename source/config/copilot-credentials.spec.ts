import test from 'ava';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	saveCopilotCredential,
	loadCopilotCredential,
	removeCopilotCredential,
} from './copilot-credentials.js';

let testConfigDir: string;
let originalConfigDir: string | undefined;

test.before(() => {
	testConfigDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'nanocoder-copilot-credentials-'),
	);
	originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = testConfigDir;
});

test.afterEach(() => {
	const credentialsPath = path.join(testConfigDir, 'copilot-credentials.json');
	if (fs.existsSync(credentialsPath)) {
		fs.unlinkSync(credentialsPath);
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

test.serial('saveCopilotCredential saves credential correctly', t => {
	saveCopilotCredential('TestProvider', 'test-refresh-token');

	const credential = loadCopilotCredential('TestProvider');
	t.truthy(credential);
	t.is(credential!.oauthToken, 'test-refresh-token');
});

test.serial('loadCopilotCredential returns null for non-existent provider', t => {
	const credential = loadCopilotCredential('NonExistentProvider');
	t.is(credential, null);
});

test.serial('removeCopilotCredential removes credential', t => {
	saveCopilotCredential('ToRemove', 'token-to-remove');

	t.truthy(loadCopilotCredential('ToRemove'));

	removeCopilotCredential('ToRemove');

	t.is(loadCopilotCredential('ToRemove'), null);
});

test.serial('saveCopilotCredential handles enterprise URLs', t => {
	saveCopilotCredential(
		'EnterpriseProvider',
		'enterprise-token',
		'github.enterprise.com',
	);

	const credential = loadCopilotCredential('EnterpriseProvider');
	t.truthy(credential);
	t.is(credential!.oauthToken, 'enterprise-token');
	t.is(credential!.enterpriseUrl, 'github.enterprise.com');
});

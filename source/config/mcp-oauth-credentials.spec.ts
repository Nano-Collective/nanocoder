import test from 'ava';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	loadMCPOAuthCredential,
	mcpOAuthCredentialKey,
	removeMCPOAuthCredential,
	saveMCPOAuthCredential,
} from './mcp-oauth-credentials.js';

console.log(`\nmcp-oauth-credentials.spec.ts`);

let testConfigDir: string;
let originalConfigDir: string | undefined;

test.before(() => {
	testConfigDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'nanocoder-mcp-oauth-credentials-'),
	);
	originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = testConfigDir;
});

test.afterEach(() => {
	const credentialsPath = path.join(
		testConfigDir,
		'mcp-oauth-credentials.json',
	);
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

const SERVER = 'https://mcp.example.com/mcp';

test.serial('mcpOAuthCredentialKey normalizes equivalent URLs', t => {
	t.is(
		mcpOAuthCredentialKey('https://MCP.Example.com/mcp#x'),
		'https://mcp.example.com/mcp',
	);
	t.is(
		mcpOAuthCredentialKey('https://mcp.example.com/'),
		'https://mcp.example.com',
	);
	t.is(mcpOAuthCredentialKey('not a url'), 'not a url');
});

test.serial('returns null when nothing is stored', t => {
	t.is(loadMCPOAuthCredential(SERVER), null);
});

test.serial('save merges tokens and client information', t => {
	saveMCPOAuthCredential(SERVER, {
		clientInformation: {client_id: 'abc'},
	});
	saveMCPOAuthCredential(SERVER, {
		tokens: {access_token: 'tok', token_type: 'Bearer', expires_in: 3600},
		tokensSavedAt: 1234,
	});
	const loaded = loadMCPOAuthCredential(SERVER);
	t.is(loaded?.clientInformation?.client_id, 'abc');
	t.is(loaded?.tokens?.access_token, 'tok');
	t.is(loaded?.tokensSavedAt, 1234);
	// Two spellings of the same endpoint share one entry.
	t.is(
		loadMCPOAuthCredential('https://MCP.EXAMPLE.COM/mcp')?.tokens?.access_token,
		'tok',
	);
});

test.serial('credentials file is owner-only', t => {
	saveMCPOAuthCredential(SERVER, {
		tokens: {access_token: 'tok', token_type: 'Bearer'},
	});
	const credentialsPath = path.join(
		testConfigDir,
		'mcp-oauth-credentials.json',
	);
	t.true(fs.existsSync(credentialsPath));
	if (process.platform !== 'win32') {
		t.is(fs.statSync(credentialsPath).mode & 0o777, 0o600);
	}
});

test.serial('remove supports tokens-only, client-only and all scopes', t => {
	saveMCPOAuthCredential(SERVER, {
		clientInformation: {client_id: 'abc'},
		tokens: {access_token: 'tok', token_type: 'Bearer'},
		tokensSavedAt: 1,
	});

	t.true(removeMCPOAuthCredential(SERVER, 'tokens'));
	let loaded = loadMCPOAuthCredential(SERVER);
	t.is(loaded?.tokens, undefined);
	t.is(loaded?.tokensSavedAt, undefined);
	t.is(loaded?.clientInformation?.client_id, 'abc');

	t.true(removeMCPOAuthCredential(SERVER, 'client'));
	loaded = loadMCPOAuthCredential(SERVER);
	t.is(loaded?.clientInformation, undefined);

	t.true(removeMCPOAuthCredential(SERVER));
	t.is(loadMCPOAuthCredential(SERVER), null);
	t.false(removeMCPOAuthCredential(SERVER));
});

test.serial('other servers are untouched by a removal', t => {
	saveMCPOAuthCredential(SERVER, {
		tokens: {access_token: 'a', token_type: 'Bearer'},
	});
	saveMCPOAuthCredential('https://other.example.com/mcp', {
		tokens: {access_token: 'b', token_type: 'Bearer'},
	});
	removeMCPOAuthCredential(SERVER);
	t.is(
		loadMCPOAuthCredential('https://other.example.com/mcp')?.tokens
			?.access_token,
		'b',
	);
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'ava';
import {createJsonCredentialStore} from './json-credential-store.js';

let testConfigDir: string;
let originalConfigDir: string | undefined;

test.beforeEach(() => {
	testConfigDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'nanocoder-json-credential-store-'),
	);
	originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = testConfigDir;
});

test.afterEach.always(() => {
	fs.rmSync(testConfigDir, {recursive: true, force: true});
	if (originalConfigDir === undefined) {
		delete process.env.NANOCODER_CONFIG_DIR;
	} else {
		process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
	}
});

const posixOnly = process.platform === 'win32' ? test.serial.skip : test.serial;

test.serial('write then load round-trips the store', t => {
	const store = createJsonCredentialStore<{token: string}>('creds.json');
	store.write({Provider: {token: 'secret'}});
	t.deepEqual(store.load(), {Provider: {token: 'secret'}});
});

posixOnly(
	'write never puts the secrets in the existing, wider-mode file',
	t => {
		const credentialsPath = path.join(testConfigDir, 'creds.json');
		fs.writeFileSync(credentialsPath, '{}', {mode: 0o644});
		fs.chmodSync(credentialsPath, 0o644);
		// A second name for the existing inode. Writing in place (then chmod)
		// puts the new secrets in that inode while it is still 0644; a
		// temp-file-and-rename leaves it untouched.
		const otherName = path.join(testConfigDir, 'other-name.json');
		fs.linkSync(credentialsPath, otherName);

		const store = createJsonCredentialStore<{token: string}>('creds.json');
		store.write({Provider: {token: 'secret'}});

		t.is(fs.readFileSync(otherName, 'utf-8'), '{}');
		t.is(fs.statSync(credentialsPath).mode & 0o777, 0o600);
		t.deepEqual(store.load(), {Provider: {token: 'secret'}});
		t.deepEqual(
			fs.readdirSync(testConfigDir).filter(name => name.endsWith('.tmp')),
			[],
			'no temp file left behind',
		);
	},
);

posixOnly('write creates a new store owner-only', t => {
	const store = createJsonCredentialStore<{token: string}>('creds.json');
	store.write({Provider: {token: 'secret'}});
	const mode = fs.statSync(path.join(testConfigDir, 'creds.json')).mode;
	t.is(mode & 0o777, 0o600);
});

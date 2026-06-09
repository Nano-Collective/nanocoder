import test from 'ava';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {AIProviderConfig} from '@/types/index';
import {getTlsConnectOptions} from './tls-config.js';

test('getTlsConnectOptions returns empty object when caCertPath is not set', t => {
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['test-model'],
		config: {},
	};

	t.deepEqual(getTlsConnectOptions(config), {});
});

test('getTlsConnectOptions loads CA bundle from caCertPath', t => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-ca-test-'));
	const caPath = path.join(tmpDir, 'ca.pem');
	fs.writeFileSync(caPath, 'test-ca-bundle');

	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['test-model'],
		config: {
			caCertPath: caPath,
		},
	};

	try {
		t.deepEqual(getTlsConnectOptions(config), {
			ca: 'test-ca-bundle',
		});
	} finally {
		fs.rmSync(tmpDir, {recursive: true, force: true});
	}
});

test('getTlsConnectOptions throws with descriptive error when caCertPath does not exist', t => {
	const missingPath = path.join(os.tmpdir(), 'nanocoder-missing-ca-does-not-exist.pem');
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['test-model'],
		config: {
			caCertPath: missingPath,
		},
	};

	const err = t.throws(() => getTlsConnectOptions(config));
	t.true(err!.message.includes(missingPath));
	t.true(err!.message.includes('not found'));
});

test('getTlsConnectOptions throws when caCertPath points to an empty file', t => {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-ca-empty-'));
	const caPath = path.join(tmpDir, 'empty.pem');
	fs.writeFileSync(caPath, '   \n');

	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['test-model'],
		config: {
			caCertPath: caPath,
		},
	};

	try {
		const err = t.throws(() => getTlsConnectOptions(config));
		t.true(err!.message.includes(caPath));
		t.true(err!.message.includes('empty'));
	} finally {
		fs.rmSync(tmpDir, {recursive: true, force: true});
	}
});

test('getTlsConnectOptions trims whitespace around caCertPath before reading', t => {
	const tmpDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'nanocoder-ca-trim-'),
	);
	const caPath = path.join(tmpDir, 'ca.pem');
	fs.writeFileSync(caPath, 'trim-bundle');

	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['test-model'],
		config: {
			caCertPath: `  ${caPath}\n`,
		},
	};

	try {
		t.deepEqual(getTlsConnectOptions(config), {ca: 'trim-bundle'});
	} finally {
		fs.rmSync(tmpDir, {recursive: true, force: true});
	}
});

test('getTlsConnectOptions returns empty when caCertPath is whitespace only', t => {
	const config: AIProviderConfig = {
		name: 'TestProvider',
		type: 'openai',
		models: ['test-model'],
		config: {
			caCertPath: '   \t\n',
		},
	};

	t.deepEqual(getTlsConnectOptions(config), {});
});

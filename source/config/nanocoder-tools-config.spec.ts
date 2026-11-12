import test from 'ava';
import {existsSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {clearAppConfig} from '@/config/index';
import {
	describeWebSearchEngine,
	getWebSearchStatus,
	isNanocoderToolAlwaysAllowed,
} from '@/config/nanocoder-tools-config';

const testConfigDir = join(process.cwd(), '.test-config-nanocoder-tools');
const testConfigPath = join(testConfigDir, 'agents.config.json');

function setupConfig(config: Record<string, unknown>) {
	if (!existsSync(testConfigDir)) {
		mkdirSync(testConfigDir, {recursive: true});
	}
	writeFileSync(testConfigPath, JSON.stringify(config));
}

function cleanupConfig() {
	if (existsSync(testConfigDir)) {
		rmSync(testConfigDir, {recursive: true});
	}
}

// Save and restore cwd for tests that change it
const originalCwd = process.cwd();

test.afterEach(() => {
	process.chdir(originalCwd);
	clearAppConfig();
	cleanupConfig();
});

test.serial(
	'isNanocoderToolAlwaysAllowed returns true for tool in top-level alwaysAllow',
	t => {
		setupConfig({
			nanocoder: {
				alwaysAllow: ['execute_bash', 'read_file'],
			},
		});
		process.chdir(testConfigDir);
		clearAppConfig();

		t.true(isNanocoderToolAlwaysAllowed('execute_bash'));
		t.true(isNanocoderToolAlwaysAllowed('read_file'));
		t.false(isNanocoderToolAlwaysAllowed('write_file'));
	},
);

test.serial(
	'isNanocoderToolAlwaysAllowed ignores removed nanocoderTools.alwaysAllow path',
	t => {
		setupConfig({
			nanocoder: {
				nanocoderTools: {
					alwaysAllow: ['execute_bash'],
				},
			},
		});
		process.chdir(testConfigDir);
		clearAppConfig();

		t.false(isNanocoderToolAlwaysAllowed('execute_bash'));
	},
);

test.serial(
	'isNanocoderToolAlwaysAllowed returns false when no config exists',
	t => {
		clearAppConfig();

		t.false(isNanocoderToolAlwaysAllowed('execute_bash'));
	},
);

test.serial(
	'isNanocoderToolAlwaysAllowed returns false when alwaysAllow is not an array',
	t => {
		setupConfig({
			nanocoder: {
				alwaysAllow: 'execute_bash',
			},
		});
		process.chdir(testConfigDir);
		clearAppConfig();

		t.false(isNanocoderToolAlwaysAllowed('execute_bash'));
	},
);

function webSearchStatusFor(webSearch: Record<string, unknown>) {
	setupConfig({nanocoder: {nanocoderTools: {webSearch}}});
	process.chdir(testConfigDir);
	clearAppConfig();
	return getWebSearchStatus();
}

test.serial('getWebSearchStatus defaults to Brave and needs its apiKey', t => {
	t.deepEqual(webSearchStatusFor({apiKey: ' brave-key '}), {
		available: true,
		settings: {
			engine: 'brave',
			apiKey: 'brave-key',
			baseUrl: undefined,
			allowPrivateNetwork: false,
		},
	});
	t.deepEqual(webSearchStatusFor({apiKey: '  '}), {
		available: false,
		reason: 'no Brave Search API key',
	});
});

test.serial('getWebSearchStatus uses SearXNG with a baseUrl and no key', t => {
	const status = webSearchStatusFor({
		engine: 'searxng',
		baseUrl: 'http://localhost:8888',
		allowPrivateNetwork: true,
	});
	t.true(status.available);
	if (status.available) {
		t.is(status.settings.engine, 'searxng');
		t.true(status.settings.allowPrivateNetwork);
		t.is(describeWebSearchEngine(status.settings), 'SearXNG (localhost:8888)');
	}
	t.deepEqual(webSearchStatusFor({engine: 'searxng', apiKey: 'unused'}), {
		available: false,
		reason: 'no SearXNG base URL',
	});
});

test.serial('getWebSearchStatus reports an unknown engine', t => {
	const status = webSearchStatusFor({engine: 'google', apiKey: 'k'});
	t.false(status.available);
	if (!status.available) {
		t.regex(status.reason, /unknown engine "google"/);
	}
});

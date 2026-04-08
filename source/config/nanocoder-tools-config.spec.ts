import test from 'ava';
import {existsSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {clearAppConfig} from '@/config/index';
import {isNanocoderToolAlwaysAllowed} from '@/config/nanocoder-tools-config';

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
	'isNanocoderToolAlwaysAllowed returns true for tool in nanocoderTools.alwaysAllow',
	t => {
		setupConfig({
			nanocoder: {
				nanocoderTools: {
					alwaysAllow: ['execute_bash', 'read_file'],
				},
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
	'isNanocoderToolAlwaysAllowed returns true for tool in top-level alwaysAllow',
	t => {
		setupConfig({
			nanocoder: {
				alwaysAllow: ['execute_bash'],
			},
		});
		process.chdir(testConfigDir);
		clearAppConfig();

		t.true(isNanocoderToolAlwaysAllowed('execute_bash'));
		t.false(isNanocoderToolAlwaysAllowed('write_file'));
	},
);

test.serial(
	'isNanocoderToolAlwaysAllowed checks both lists',
	t => {
		setupConfig({
			nanocoder: {
				alwaysAllow: ['execute_bash'],
				nanocoderTools: {
					alwaysAllow: ['read_file'],
				},
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
	'isNanocoderToolAlwaysAllowed returns false when no config exists',
	t => {
		// Don't set up any config file
		clearAppConfig();

		t.false(isNanocoderToolAlwaysAllowed('execute_bash'));
	},
);

test.serial(
	'isNanocoderToolAlwaysAllowed returns false when alwaysAllow is not an array',
	t => {
		setupConfig({
			nanocoder: {
				nanocoderTools: {
					alwaysAllow: 'execute_bash',
				},
			},
		});
		process.chdir(testConfigDir);
		clearAppConfig();

		t.false(isNanocoderToolAlwaysAllowed('execute_bash'));
	},
);

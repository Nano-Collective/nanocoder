import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import test from 'ava';
import {confDirMap, getClosestConfigFile, reloadAppConfig} from './index';

console.log(`\nindex.spec.ts`);

// Create a temporary test directory
const testDir = join(tmpdir(), `nanocoder-test-${Date.now()}`);

test.before(() => {
	// Create test directory
	mkdirSync(testDir, {recursive: true});
});

test.after.always(() => {
	// Clean up test directory
	if (existsSync(testDir)) {
		rmSync(testDir, {recursive: true, force: true});
	}
});

test('getClosestConfigFile creates default config if none exists', t => {
	const fileName = 'test-config.json';
	const configPath = getClosestConfigFile(fileName);

	t.true(existsSync(configPath), 'Config file should be created');
	t.true(configPath.includes(fileName), 'Config path should include filename');

	// Clean up
	if (existsSync(configPath)) {
		rmSync(configPath, {force: true});
	}
});

test('getClosestConfigFile prefers cwd config over home config', t => {
	const fileName = 'test-priority.json';
	const cwdConfig = join(process.cwd(), fileName);

	// Create a config in cwd
	writeFileSync(cwdConfig, JSON.stringify({test: 'cwd'}), 'utf-8');

	try {
		const configPath = getClosestConfigFile(fileName);
		t.is(configPath, cwdConfig, 'Should prefer cwd config');
		t.is(confDirMap[fileName], cwdConfig, 'Should store cwd path in map');

		// Verify it returns the cwd config content
		const content = JSON.parse(readFileSync(configPath, 'utf-8'));
		t.deepEqual(content, {test: 'cwd'});
	} finally {
		// Clean up
		if (existsSync(cwdConfig)) {
			rmSync(cwdConfig, {force: true});
		}
	}
});

test('confDirMap stores config file locations', t => {
	const fileName = 'test-map.json';

	// Clear any existing entry
	delete confDirMap[fileName];

	const configPath = getClosestConfigFile(fileName);

	t.true(fileName in confDirMap, 'Config map should have entry');
	t.is(
		confDirMap[fileName],
		configPath,
		'Config map should store correct path',
	);

	// Clean up
	if (existsSync(configPath)) {
		rmSync(configPath, {force: true});
	}
});

test('getClosestConfigFile handles missing config directory gracefully', t => {
	const fileName = 'new-config.json';

	// This should create the config directory and file
	t.notThrows(() => {
		const configPath = getClosestConfigFile(fileName);
		t.true(existsSync(configPath), 'Should create config file');
	});

	// Clean up
	const configPath = confDirMap[fileName];
	if (configPath && existsSync(configPath)) {
		rmSync(configPath, {force: true});
	}
});

test('reloadAppConfig can be called without errors', t => {
	// This test ensures reloadAppConfig doesn't throw
	t.notThrows(() => {
		reloadAppConfig();
	});
});

test('default config file contains valid JSON', t => {
	const fileName = 'test-default.json';
	const configPath = getClosestConfigFile(fileName);

	// Read and parse the created config
	const content = readFileSync(configPath, 'utf-8');

	t.notThrows(() => {
		JSON.parse(content);
	}, 'Default config should be valid JSON');

	// Clean up
	if (existsSync(configPath)) {
		rmSync(configPath, {force: true});
	}
});

test('loadAppConfig handles malformed JSON gracefully', async t => {
	const fileName = 'malformed-config.json';
	const configPath = getClosestConfigFile(fileName);

	// Write malformed JSON to the config file
	writeFileSync(configPath, '{ "nanocoder": { "providers": [ }, "mcpServers": [ ] }', 'utf-8');

	try {
		// This should not throw, but should log a warning
		const {reloadAppConfig} = await import('./index.js');
		reloadAppConfig();
		t.pass('Should handle malformed JSON without throwing');
	} finally {
		// Clean up
		if (existsSync(configPath)) {
			rmSync(configPath, {force: true});
		}
	}
});

test('loadAppConfig handles missing file gracefully', async t => {
	// This test ensures that when the config file is missing,
	// the function falls back to defaults without throwing
	const originalCwd = process.cwd();
	
	try {
		// Change to a directory where the config file doesn't exist
		process.chdir(testDir);
		
		const {reloadAppConfig} = await import('./index.js');
		reloadAppConfig();
		t.pass('Should handle missing config file without throwing');
	} finally {
		// Restore original directory
		process.chdir(originalCwd);
	}
});

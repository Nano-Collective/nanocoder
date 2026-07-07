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

// Tests for loadDefaultMode
const defaultModeTestDir = join(
	tmpdir(),
	`nanocoder-default-mode-test-${Date.now()}`,
);

test.before(() => {
	mkdirSync(defaultModeTestDir, {recursive: true});
});

test.after.always(() => {
	if (existsSync(defaultModeTestDir)) {
		rmSync(defaultModeTestDir, {recursive: true, force: true});
	}
});

test.serial('loadDefaultMode returns undefined when no config exists', async t => {
	const originalCwd = process.cwd();
	const originalEnv = process.env.NANOCODER_CONFIG_DIR;

	try {
		process.chdir(defaultModeTestDir);
		process.env.NANOCODER_CONFIG_DIR = join(defaultModeTestDir, 'empty-config');

		const {loadDefaultMode: fn} = await import('./index.js');
		const result = fn();
		t.is(result, undefined, 'Should return undefined when no config exists');
	} finally {
		process.chdir(originalCwd);
		if (originalEnv !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalEnv;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
	}
});

for (const mode of ['normal', 'auto-accept', 'yolo', 'plan']) {
	test.serial(
		`loadDefaultMode accepts valid mode '${mode}' from project config`,
		async t => {
			const originalCwd = process.cwd();
			const originalEnv = process.env.NANOCODER_CONFIG_DIR;
			const testSubdir = join(defaultModeTestDir, `project-${mode}`);
			mkdirSync(testSubdir, {recursive: true});

			try {
				writeFileSync(
					join(testSubdir, 'agents.config.json'),
					JSON.stringify({nanocoder: {defaultMode: mode}}),
					'utf-8',
				);
				process.chdir(testSubdir);
				process.env.NANOCODER_CONFIG_DIR = join(testSubdir, 'nonexistent-global');

				const {loadDefaultMode: fn} = await import('./index.js');
				t.is(fn(), mode, `Should return '${mode}' from project config`);
			} finally {
				process.chdir(originalCwd);
				if (originalEnv !== undefined) {
					process.env.NANOCODER_CONFIG_DIR = originalEnv;
				} else {
					delete process.env.NANOCODER_CONFIG_DIR;
				}
			}
		},
	);
}

test.serial('loadDefaultMode prefers project config over global config', async t => {
	const originalCwd = process.cwd();
	const originalEnv = process.env.NANOCODER_CONFIG_DIR;
	const projectDir = join(defaultModeTestDir, 'project-prefer');
	const globalDir = join(defaultModeTestDir, 'global-prefer');
	mkdirSync(projectDir, {recursive: true});
	mkdirSync(globalDir, {recursive: true});

	try {
		writeFileSync(
			join(projectDir, 'agents.config.json'),
			JSON.stringify({nanocoder: {defaultMode: 'yolo'}}),
			'utf-8',
		);
		writeFileSync(
			join(globalDir, 'agents.config.json'),
			JSON.stringify({nanocoder: {defaultMode: 'plan'}}),
			'utf-8',
		);
		process.chdir(projectDir);
		process.env.NANOCODER_CONFIG_DIR = globalDir;

		const {loadDefaultMode: fn} = await import('./index.js');
		t.is(fn(), 'yolo', 'Project config should take precedence over global');
	} finally {
		process.chdir(originalCwd);
		if (originalEnv !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalEnv;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
	}
});

test.serial('loadDefaultMode loads from global config when project config is missing', async t => {
	const originalCwd = process.cwd();
	const originalEnv = process.env.NANOCODER_CONFIG_DIR;
	const emptyProjectDir = join(defaultModeTestDir, 'empty-project-global-fallback');
	const globalDir = join(defaultModeTestDir, 'global-fallback');
	mkdirSync(emptyProjectDir, {recursive: true});
	mkdirSync(globalDir, {recursive: true});

	try {
		writeFileSync(
			join(globalDir, 'agents.config.json'),
			JSON.stringify({nanocoder: {defaultMode: 'plan'}}),
			'utf-8',
		);
		process.chdir(emptyProjectDir);
		process.env.NANOCODER_CONFIG_DIR = globalDir;

		const {loadDefaultMode: fn} = await import('./index.js');
		t.is(fn(), 'plan', 'Should fall back to global config');
	} finally {
		process.chdir(originalCwd);
		if (originalEnv !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalEnv;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
	}
});

test.serial('loadDefaultMode normalizes case-insensitive values', async t => {
	const originalCwd = process.cwd();
	const originalEnv = process.env.NANOCODER_CONFIG_DIR;
	const testSubdir = join(defaultModeTestDir, 'case-normalize');
	mkdirSync(testSubdir, {recursive: true});

	try {
		writeFileSync(
			join(testSubdir, 'agents.config.json'),
			JSON.stringify({nanocoder: {defaultMode: 'Yolo'}}),
			'utf-8',
		);
		process.chdir(testSubdir);
		process.env.NANOCODER_CONFIG_DIR = join(testSubdir, 'nonexistent-global');

		const {loadDefaultMode: fn} = await import('./index.js');
		t.is(fn(), 'yolo', 'Should normalize uppercase values to lowercase');
	} finally {
		process.chdir(originalCwd);
		if (originalEnv !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalEnv;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
	}
});

// Tests for systemPrompt config loading
const systemPromptTestDir = join(
	tmpdir(),
	`nanocoder-system-prompt-test-${Date.now()}`,
);

test.before(() => {
	mkdirSync(systemPromptTestDir, {recursive: true});
});

test.after.always(() => {
	if (existsSync(systemPromptTestDir)) {
		rmSync(systemPromptTestDir, {recursive: true, force: true});
	}
});

async function withSystemPromptConfig(
	subdir: string,
	configBody: unknown,
	assertion: (systemPrompt: unknown) => void,
): Promise<void> {
	const originalCwd = process.cwd();
	const originalEnv = process.env.NANOCODER_CONFIG_DIR;
	const testSubdir = join(systemPromptTestDir, subdir);
	mkdirSync(testSubdir, {recursive: true});

	try {
		writeFileSync(
			join(testSubdir, 'agents.config.json'),
			JSON.stringify(configBody),
			'utf-8',
		);
		process.chdir(testSubdir);
		process.env.NANOCODER_CONFIG_DIR = join(testSubdir, 'nonexistent-global');

		const {reloadAppConfig: reload, getAppConfig} = await import('./index.js');
		reload();
		assertion(getAppConfig().systemPrompt);
	} finally {
		process.chdir(originalCwd);
		if (originalEnv !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalEnv;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
	}
}

test.serial('loadSystemPromptConfig returns undefined when not configured', async t => {
	await withSystemPromptConfig(
		'system-prompt-empty',
		{nanocoder: {}},
		systemPrompt => {
			t.is(systemPrompt, undefined);
		},
	);
});

test.serial('loadSystemPromptConfig loads inline content', async t => {
	await withSystemPromptConfig(
		'system-prompt-inline',
		{
			nanocoder: {
				systemPrompt: {mode: 'replace', content: 'Be concise.'},
			},
		},
		systemPrompt => {
			t.deepEqual(systemPrompt, {mode: 'replace', content: 'Be concise.'});
		},
	);
});

test.serial('loadSystemPromptConfig loads file path', async t => {
	await withSystemPromptConfig(
		'system-prompt-file',
		{
			nanocoder: {
				systemPrompt: {mode: 'append', file: './prompt.md'},
			},
		},
		systemPrompt => {
			t.deepEqual(systemPrompt, {mode: 'append', file: './prompt.md'});
		},
	);
});

test.serial('loadSystemPromptConfig ignores invalid mode value', async t => {
	await withSystemPromptConfig(
		'system-prompt-bad-mode',
		{
			nanocoder: {
				systemPrompt: {mode: 'merge', content: 'X'},
			},
		},
		systemPrompt => {
			// mode dropped, but content kept
			t.deepEqual(systemPrompt, {content: 'X'});
		},
	);
});

test.serial('loadSystemPromptConfig returns undefined when neither content nor file set', async t => {
	await withSystemPromptConfig(
		'system-prompt-empty-fields',
		{
			nanocoder: {
				systemPrompt: {mode: 'replace'},
			},
		},
		systemPrompt => {
			t.is(systemPrompt, undefined);
		},
	);
});

test.serial('loadDefaultMode returns undefined for invalid mode values', async t => {
	const originalCwd = process.cwd();
	const originalEnv = process.env.NANOCODER_CONFIG_DIR;
	const testSubdir = join(defaultModeTestDir, 'invalid-mode');
	mkdirSync(testSubdir, {recursive: true});

	try {
		writeFileSync(
			join(testSubdir, 'agents.config.json'),
			JSON.stringify({nanocoder: {defaultMode: 'invalid-mode'}}),
			'utf-8',
		);
		process.chdir(testSubdir);
		process.env.NANOCODER_CONFIG_DIR = join(testSubdir, 'nonexistent-global');

		const {loadDefaultMode: fn} = await import('./index.js');
		t.is(fn(), undefined, 'Should return undefined for unrecognized mode value');
	} finally {
		process.chdir(originalCwd);
		if (originalEnv !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalEnv;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
	}
});

const headlessTestDir = join(tmpdir(), `nanocoder-headless-test-${Date.now()}`);

test.before(() => {
	mkdirSync(headlessTestDir, {recursive: true});
});

test.after.always(() => {
	if (existsSync(headlessTestDir)) {
		rmSync(headlessTestDir, {recursive: true, force: true});
	}
});

async function withHeadlessConfig(
	subdir: string,
	configBody: unknown,
	envMaxTurns: string | undefined,
	assertion: (
		headless: {maxTurns?: number} | undefined,
		fallback: number,
	) => void,
): Promise<void> {
	const originalCwd = process.cwd();
	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	const originalMaxTurns = process.env.NANOCODER_MAX_TURNS;
	const testSubdir = join(headlessTestDir, subdir);
	mkdirSync(testSubdir, {recursive: true});

	try {
		writeFileSync(
			join(testSubdir, 'agents.config.json'),
			JSON.stringify(configBody),
			'utf-8',
		);
		process.chdir(testSubdir);
		process.env.NANOCODER_CONFIG_DIR = join(testSubdir, 'nonexistent-global');
		if (envMaxTurns !== undefined) {
			process.env.NANOCODER_MAX_TURNS = envMaxTurns;
		} else {
			delete process.env.NANOCODER_MAX_TURNS;
		}

		const {
			reloadAppConfig: reload,
			getAppConfig,
			DEFAULT_HEADLESS_MAX_TURNS,
		} = await import('./index.js');
		reload();
		assertion(getAppConfig().headless, DEFAULT_HEADLESS_MAX_TURNS);
	} finally {
		process.chdir(originalCwd);
		if (originalConfigDir !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
		if (originalMaxTurns !== undefined) {
			process.env.NANOCODER_MAX_TURNS = originalMaxTurns;
		} else {
			delete process.env.NANOCODER_MAX_TURNS;
		}
	}
}

test.serial('headless maxTurns defaults when not configured', async t => {
	await withHeadlessConfig(
		'headless-default',
		{nanocoder: {}},
		undefined,
		(headless, fallback) => {
			t.is(headless?.maxTurns, fallback);
		},
	);
});

test.serial('headless maxTurns loads from config', async t => {
	await withHeadlessConfig(
		'headless-config',
		{nanocoder: {headless: {maxTurns: 500}}},
		undefined,
		headless => {
			t.is(headless?.maxTurns, 500);
		},
	);
});

test.serial('headless maxTurns env var overrides config', async t => {
	await withHeadlessConfig(
		'headless-env-override',
		{nanocoder: {headless: {maxTurns: 500}}},
		'42',
		headless => {
			t.is(headless?.maxTurns, 42);
		},
	);
});

test.serial('headless maxTurns clamps config to at least 1', async t => {
	await withHeadlessConfig(
		'headless-clamp',
		{nanocoder: {headless: {maxTurns: 0}}},
		undefined,
		headless => {
			t.is(headless?.maxTurns, 1);
		},
	);
});

test.serial('headless maxTurns ignores invalid env var', async t => {
	await withHeadlessConfig(
		'headless-bad-env',
		{nanocoder: {headless: {maxTurns: 500}}},
		'not-a-number',
		headless => {
			t.is(headless?.maxTurns, 500);
		},
	);
});

// Tests for modeProviders
async function withModeProvidersConfig(
	testName: string,
	configData: Record<string, unknown>,
	assertionFn: (modeProviders: any) => void,
) {
	const {tmpdir} = await import('os');
	const {join} = await import('path');
	const {mkdirSync, writeFileSync, rmSync} = await import('fs');
	
	const originalCwd = process.cwd();
	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	const testDir = join(tmpdir(), `nanocoder-modeproviders-test-${Date.now()}-${testName}`);
	mkdirSync(testDir, {recursive: true});

	try {
		// Define some valid providers to test against
		const providers = [
			{
				name: 'TestProvider1',
				models: ['model1', 'model2'],
			},
			{
				name: 'TestProvider2',
				models: [],
			}
		];
		
		const fullConfig = {
			...configData,
			nanocoder: {
				...(configData.nanocoder as any || {}),
				providers,
			}
		};

		writeFileSync(
			join(testDir, 'agents.config.json'),
			JSON.stringify(fullConfig),
			'utf-8',
		);
		process.chdir(testDir);
		process.env.NANOCODER_CONFIG_DIR = testDir;

		const {
			reloadAppConfig: reload,
			getAppConfig,
		} = await import('./index.js');
		
		reload();
		assertionFn(getAppConfig().modeProviders);
	} finally {
		process.chdir(originalCwd);
		if (originalConfigDir !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
		rmSync(testDir, {recursive: true, force: true});
	}
}

test.serial('modeProviders loads valid config', async t => {
	await withModeProvidersConfig(
		'valid',
		{
			nanocoder: {
				modeProviders: {
					plan: {
						provider: 'TestProvider1',
						model: 'model1'
					}
				}
			}
		},
		modeProviders => {
			t.deepEqual(modeProviders, {
				plan: {
					provider: 'TestProvider1',
					model: 'model1'
				}
			});
		}
	);
});

test.serial('modeProviders ignores missing provider or model string', async t => {
	await withModeProvidersConfig(
		'missing-fields',
		{
			nanocoder: {
				modeProviders: {
					plan: {
						provider: 'TestProvider1'
					},
					yolo: {
						model: 'model1'
					}
				}
			}
		},
		modeProviders => {
			t.is(modeProviders, undefined);
		}
	);
});

test.serial('modeProviders ignores unknown provider', async t => {
	await withModeProvidersConfig(
		'unknown-provider',
		{
			nanocoder: {
				modeProviders: {
					plan: {
						provider: 'UnknownProvider',
						model: 'model1'
					}
				}
			}
		},
		modeProviders => {
			t.is(modeProviders, undefined);
		}
	);
});

test.serial('modeProviders ignores unknown model for provider', async t => {
	await withModeProvidersConfig(
		'unknown-model',
		{
			nanocoder: {
				modeProviders: {
					plan: {
						provider: 'TestProvider1',
						model: 'unknown-model'
					}
				}
			}
		},
		modeProviders => {
			t.is(modeProviders, undefined);
		}
	);
});

test.serial('modeProviders accepts model if provider has empty models list', async t => {
	await withModeProvidersConfig(
		'empty-models-list',
		{
			nanocoder: {
				modeProviders: {
					plan: {
						provider: 'TestProvider2',
						model: 'any-model'
					}
				}
			}
		},
		modeProviders => {
			t.deepEqual(modeProviders, {
				plan: {
					provider: 'TestProvider2',
					model: 'any-model'
				}
			});
		}
	);
});

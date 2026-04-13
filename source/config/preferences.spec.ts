import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	getLastUsedModel,
	getNanocoderShape,
	getNotificationsPreference,
	getPasteThreshold,
	loadPreferences,
	resetPreferencesCache,
	savePreferences,
	updateLastUsed,
	updateNanocoderShape,
	updateNotificationsPreference,
	updatePasteThreshold,
} from './preferences';
import type {UserPreferences} from '@/types/index';

console.log('\npreferences.spec.ts');

// Use environment variable to isolate config directory for tests
const testConfigDir = join(tmpdir(), `nanocoder-test-config-${Date.now()}`);

test.before(() => {
	// Set config directory for all tests
	process.env.NANOCODER_CONFIG_DIR = testConfigDir;
	mkdirSync(testConfigDir, {recursive: true});
	// Reset the preferences cache to pick up the new config directory
	resetPreferencesCache();
});

test.after.always(() => {
	// Clean up test config directory
	if (existsSync(testConfigDir)) {
		rmSync(testConfigDir, {recursive: true, force: true});
	}
	// Clean up environment
	delete process.env.NANOCODER_CONFIG_DIR;
	// Reset the cache to restore normal behavior
	resetPreferencesCache();
});

// Helper to get the preferences file path
const getTestPreferencesPath = () => join(testConfigDir, 'nanocoder-preferences.json');

// ============================================================================
// loadPreferences Tests
// ============================================================================

test.serial('loadPreferences loads valid JSON file', t => {
	const preferencesPath = getTestPreferencesPath();
	const validPreferences: UserPreferences = {
		lastProvider: 'openrouter',
		lastModel: 'anthropic/claude-3-opus',
		providerModels: {
			openrouter: 'anthropic/claude-3-opus',
		},
	};

	writeFileSync(preferencesPath, JSON.stringify(validPreferences, null, 2), 'utf-8');

	try {
		const result = loadPreferences();

		t.deepEqual(result, validPreferences);
		t.is(result.lastProvider, 'openrouter');
		t.is(result.lastModel, 'anthropic/claude-3-opus');
		t.is(result.providerModels?.openrouter, 'anthropic/claude-3-opus');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('loadPreferences returns empty object when file does not exist', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	const result = loadPreferences();

	t.deepEqual(result, {});
});

test.serial('loadPreferences returns empty object for invalid JSON', t => {
	const preferencesPath = getTestPreferencesPath();

	writeFileSync(preferencesPath, '{ invalid json }', 'utf-8');

	try {
		const result = loadPreferences();

		t.deepEqual(result, {});
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('loadPreferences returns empty object for empty file', t => {
	const preferencesPath = getTestPreferencesPath();

	writeFileSync(preferencesPath, '', 'utf-8');

	try {
		const result = loadPreferences();

		t.deepEqual(result, {});
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('loadPreferences returns empty object for JSON with syntax errors', t => {
	const preferencesPath = getTestPreferencesPath();

	writeFileSync(preferencesPath, '{"lastProvider": "test",}', 'utf-8');

	try {
		const result = loadPreferences();

		t.deepEqual(result, {});
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// savePreferences Tests
// ============================================================================

test.serial('savePreferences writes JSON file with proper formatting', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {
		lastProvider: 'openrouter',
		lastModel: 'anthropic/claude-3-sonnet',
		providerModels: {
			openrouter: 'anthropic/claude-3-sonnet',
		},
	};

	try {
		savePreferences(preferences);

		t.true(existsSync(preferencesPath));

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.deepEqual(parsed, preferences);
		// Check formatting (should have indentation)
		t.true(content.includes('\n'));
		t.true(content.includes('  ')); // Indented with 2 spaces
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('savePreferences creates new file if it does not exist', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}
	const preferences: UserPreferences = {lastProvider: 'test'};

	try {
		savePreferences(preferences);

		t.true(existsSync(preferencesPath));

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.lastProvider, 'test');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('savePreferences overwrites existing file', t => {
	const preferencesPath = getTestPreferencesPath();

	// Create initial file
	const initialPreferences: UserPreferences = {lastProvider: 'initial'};
	writeFileSync(preferencesPath, JSON.stringify(initialPreferences, null, 2), 'utf-8');

	const newPreferences: UserPreferences = {
		lastProvider: 'updated',
		lastModel: 'new-model',
	};

	try {
		savePreferences(newPreferences);

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.lastProvider, 'updated');
		t.is(parsed.lastModel, 'new-model');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('savePreferences saves all UserPreferences fields', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {
		lastProvider: 'openrouter',
		lastModel: 'claude-3-opus',
		selectedTheme: 'tokyo-night',
		trustedDirectories: ['/home/user/project'],
		lastUpdateCheck: 1234567890,
	};

	try {
		savePreferences(preferences);

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.lastProvider, 'openrouter');
		t.is(parsed.selectedTheme, 'tokyo-night');
		t.deepEqual(parsed.trustedDirectories, ['/home/user/project']);
		t.is(parsed.lastUpdateCheck, 1234567890);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// updateLastUsed Tests
// ============================================================================

test.serial('updateLastUsed saves provider and model', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateLastUsed('openrouter', 'anthropic/claude-3-opus');

		t.true(existsSync(preferencesPath));

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.lastProvider, 'openrouter');
		t.is(parsed.lastModel, 'anthropic/claude-3-opus');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateLastUsed creates providerModels object if not exists', t => {
	const preferencesPath = getTestPreferencesPath();

	// Start with empty preferences file
	writeFileSync(preferencesPath, '{}', 'utf-8');

	try {
		updateLastUsed('openrouter', 'anthropic/claude-3-opus');

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.truthy(parsed.providerModels);
		t.is(parsed.providerModels?.openrouter, 'anthropic/claude-3-opus');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateLastUsed preserves existing providerModels', t => {
	const preferencesPath = getTestPreferencesPath();
	const existingPreferences: UserPreferences = {
		providerModels: {
			existing: 'existing-model',
		},
	};
	writeFileSync(preferencesPath, JSON.stringify(existingPreferences, null, 2), 'utf-8');

	try {
		updateLastUsed('newprovider', 'new-model');

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.providerModels?.existing, 'existing-model');
		t.is(parsed.providerModels?.newprovider, 'new-model');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateLastUsed overwrites model for same provider', t => {
	const preferencesPath = getTestPreferencesPath();
	const existingPreferences: UserPreferences = {
		providerModels: {
			openrouter: 'old-model',
		},
	};
	writeFileSync(preferencesPath, JSON.stringify(existingPreferences, null, 2), 'utf-8');

	try {
		updateLastUsed('openrouter', 'new-model');

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.providerModels?.openrouter, 'new-model');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateLastUsed handles multiple providers', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateLastUsed('provider1', 'model1');
		updateLastUsed('provider2', 'model2');
		updateLastUsed('provider1', 'model1-updated');

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.lastProvider, 'provider1');
		t.is(parsed.lastModel, 'model1-updated');
		t.is(parsed.providerModels?.provider1, 'model1-updated');
		t.is(parsed.providerModels?.provider2, 'model2');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// getLastUsedModel Tests
// ============================================================================

test.serial('getLastUsedModel returns model for known provider', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {
		providerModels: {
			openrouter: 'anthropic/claude-3-opus',
			ollama: 'llama3',
		},
	};
	writeFileSync(preferencesPath, JSON.stringify(preferences, null, 2), 'utf-8');

	try {
		t.is(getLastUsedModel('openrouter'), 'anthropic/claude-3-opus');
		t.is(getLastUsedModel('ollama'), 'llama3');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('getLastUsedModel returns undefined for unknown provider', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {
		providerModels: {
			openrouter: 'anthropic/claude-3-opus',
		},
	};
	writeFileSync(preferencesPath, JSON.stringify(preferences, null, 2), 'utf-8');

	try {
		t.is(getLastUsedModel('unknown'), undefined);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('getLastUsedModel returns undefined when providerModels is missing', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {};
	writeFileSync(preferencesPath, JSON.stringify(preferences, null, 2), 'utf-8');

	try {
		t.is(getLastUsedModel('openrouter'), undefined);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('getLastUsedModel returns undefined when file does not exist', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	t.is(getLastUsedModel('openrouter'), undefined);
});

test.serial('getLastUsedModel returns undefined for empty providerModels object', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {
		providerModels: {},
	};
	writeFileSync(preferencesPath, JSON.stringify(preferences, null, 2), 'utf-8');

	try {
		t.is(getLastUsedModel('any-provider'), undefined);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// Integration Tests - Full Workflow
// ============================================================================

test.serial('full workflow: update and retrieve last used model', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		// Update last used
		updateLastUsed('openrouter', 'claude-3-opus');

		// Retrieve via getLastUsedModel
		const retrieved = getLastUsedModel('openrouter');

		t.is(retrieved, 'claude-3-opus');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('full workflow: load returns previously saved preferences', t => {
	const preferencesPath = getTestPreferencesPath();
	const original: UserPreferences = {
		lastProvider: 'test-provider',
		lastModel: 'test-model',
		providerModels: {
			'provider-a': 'model-a',
			'provider-b': 'model-b',
		},
	};

	try {
		savePreferences(original);
		const loaded = loadPreferences();

		t.deepEqual(loaded, original);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// Edge Cases Tests
// ============================================================================

test.serial('preferences handles null and undefined values', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {
		lastProvider: undefined,
		lastModel: undefined,
		providerModels: {
			test: undefined,
		},
	};
	writeFileSync(preferencesPath, JSON.stringify(preferences, null, 2), 'utf-8');

	try {
		const loaded = loadPreferences();
		t.is(loaded.lastProvider, undefined);
		t.is(loaded.lastModel, undefined);
		t.is(loaded.providerModels?.test, undefined);
		t.is(getLastUsedModel('test'), undefined);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('preferences preserves additional UserPreferences fields', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {
		lastProvider: 'openrouter',
		lastModel: 'claude-3-opus',
		selectedTheme: 'tokyo-night',
		trustedDirectories: ['/home/user/project'],
		lastUpdateCheck: 1234567890,
	};
	writeFileSync(preferencesPath, JSON.stringify(preferences, null, 2), 'utf-8');

	try {
		const loaded = loadPreferences();
		t.is(loaded.selectedTheme, 'tokyo-night');
		t.deepEqual(loaded.trustedDirectories, ['/home/user/project']);
		t.is(loaded.lastUpdateCheck, 1234567890);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateLastUsed can be called multiple times for same provider', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		// First call
		updateLastUsed('provider1', 'model1');

		// Second call for same provider
		updateLastUsed('provider1', 'model2');

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.lastProvider, 'provider1');
		t.is(parsed.lastModel, 'model2');
		t.is(parsed.providerModels?.provider1, 'model2');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('savePreferences handles minimal UserPreferences', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {};

	try {
		savePreferences(preferences);

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content);

		t.deepEqual(parsed, {});
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('loadPreferences handles file with only whitespace', t => {
	const preferencesPath = getTestPreferencesPath();

	writeFileSync(preferencesPath, '   \n\n  \n  ', 'utf-8');

	try {
		const result = loadPreferences();

		t.deepEqual(result, {});
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// updateNanocoderShape Tests
// ============================================================================

test.serial('updateNanocoderShape saves nanocoder shape', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateNanocoderShape('block');

		t.true(existsSync(preferencesPath));

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.nanocoderShape, 'block');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateNanocoderShape preserves existing preferences', t => {
	const preferencesPath = getTestPreferencesPath();
	const existingPreferences: UserPreferences = {
		lastProvider: 'openrouter',
		lastModel: 'claude-3-opus',
		selectedTheme: 'tokyo-night',
	};
	writeFileSync(preferencesPath, JSON.stringify(existingPreferences, null, 2), 'utf-8');

	try {
		updateNanocoderShape('chrome');

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.nanocoderShape, 'chrome');
		t.is(parsed.lastProvider, 'openrouter');
		t.is(parsed.lastModel, 'claude-3-opus');
		t.is(parsed.selectedTheme, 'tokyo-night');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateNanocoderShape overwrites existing nanocoder shape', t => {
	const preferencesPath = getTestPreferencesPath();
	const existingPreferences: UserPreferences = {
		nanocoderShape: 'tiny',
	};
	writeFileSync(preferencesPath, JSON.stringify(existingPreferences, null, 2), 'utf-8');

	try {
		updateNanocoderShape('huge');

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.nanocoderShape, 'huge');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// getNanocoderShape Tests
// ============================================================================

test.serial('getNanocoderShape returns saved nanocoder shape', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {
		nanocoderShape: 'slick',
	};
	writeFileSync(preferencesPath, JSON.stringify(preferences, null, 2), 'utf-8');

	try {
		const result = getNanocoderShape();
		t.is(result, 'slick');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('getNanocoderShape returns undefined when not set', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {};
	writeFileSync(preferencesPath, JSON.stringify(preferences, null, 2), 'utf-8');

	try {
		const result = getNanocoderShape();
		t.is(result, undefined);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('getNanocoderShape returns undefined when file does not exist', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	const result = getNanocoderShape();
	t.is(result, undefined);
});

test.serial('full workflow: update and retrieve nanocoder shape', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateNanocoderShape('grid');
		const retrieved = getNanocoderShape();
		t.is(retrieved, 'grid');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// getPasteThreshold Tests
// ============================================================================

test.serial('getPasteThreshold returns threshold from paste.singleLineThreshold', t => {
	const preferencesPath = getTestPreferencesPath();
	const data: UserPreferences = {
		lastProvider: 'openrouter',
		paste: {
			singleLineThreshold: 1500,
		},
	};
	writeFileSync(preferencesPath, JSON.stringify(data, null, 2), 'utf-8');

	try {
		const result = getPasteThreshold();
		t.is(result, 1500);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('getPasteThreshold returns undefined when paste is missing', t => {
	const preferencesPath = getTestPreferencesPath();
	writeFileSync(preferencesPath, JSON.stringify({lastProvider: 'test'}, null, 2), 'utf-8');

	try {
		const result = getPasteThreshold();
		t.is(result, undefined);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('getPasteThreshold returns undefined when file does not exist', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	const result = getPasteThreshold();
	t.is(result, undefined);
});

test.serial('getPasteThreshold returns undefined for non-positive threshold', t => {
	const preferencesPath = getTestPreferencesPath();
	const data: UserPreferences = {
		paste: {
			singleLineThreshold: -100,
		},
	};
	writeFileSync(preferencesPath, JSON.stringify(data, null, 2), 'utf-8');

	try {
		const result = getPasteThreshold();
		t.is(result, undefined);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('getPasteThreshold returns undefined for zero threshold', t => {
	const preferencesPath = getTestPreferencesPath();
	const data: UserPreferences = {
		paste: {
			singleLineThreshold: 0,
		},
	};
	writeFileSync(preferencesPath, JSON.stringify(data, null, 2), 'utf-8');

	try {
		const result = getPasteThreshold();
		t.is(result, undefined);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('getPasteThreshold rounds non-integer thresholds', t => {
	const preferencesPath = getTestPreferencesPath();
	const data = {
		paste: {
			singleLineThreshold: 1234.7,
		},
	};
	writeFileSync(preferencesPath, JSON.stringify(data, null, 2), 'utf-8');

	try {
		const result = getPasteThreshold();
		t.is(result, 1235);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('getPasteThreshold returns undefined for non-number threshold', t => {
	const preferencesPath = getTestPreferencesPath();
	const data = {
		paste: {
			singleLineThreshold: 'not-a-number',
		},
	};
	writeFileSync(preferencesPath, JSON.stringify(data, null, 2), 'utf-8');

	try {
		const result = getPasteThreshold();
		t.is(result, undefined);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// updatePasteThreshold Tests
// ============================================================================

test.serial('updatePasteThreshold saves threshold to paste.singleLineThreshold', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updatePasteThreshold(2000);

		t.true(existsSync(preferencesPath));

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.paste?.singleLineThreshold, 2000);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updatePasteThreshold preserves existing preferences', t => {
	const preferencesPath = getTestPreferencesPath();
	const existingData: UserPreferences = {
		lastProvider: 'openrouter',
		lastModel: 'claude-3-opus',
		selectedTheme: 'tokyo-night',
	};
	writeFileSync(preferencesPath, JSON.stringify(existingData, null, 2), 'utf-8');

	try {
		updatePasteThreshold(1500);

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.lastProvider, 'openrouter');
		t.is(parsed.lastModel, 'claude-3-opus');
		t.is(parsed.selectedTheme, 'tokyo-night');
		t.is(parsed.paste?.singleLineThreshold, 1500);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updatePasteThreshold overwrites existing paste threshold', t => {
	const preferencesPath = getTestPreferencesPath();
	const existingData: UserPreferences = {
		paste: {
			singleLineThreshold: 800,
		},
	};
	writeFileSync(preferencesPath, JSON.stringify(existingData, null, 2), 'utf-8');

	try {
		updatePasteThreshold(1000);

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.paste?.singleLineThreshold, 1000);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updatePasteThreshold rounds non-integer values', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updatePasteThreshold(1234.7);

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.paste?.singleLineThreshold, 1235);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updatePasteThreshold creates file if it does not exist', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updatePasteThreshold(500);

		t.true(existsSync(preferencesPath));

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.paste?.singleLineThreshold, 500);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// Paste Threshold Integration Tests
// ============================================================================

test.serial('full workflow: update and retrieve paste threshold', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updatePasteThreshold(2000);
		const retrieved = getPasteThreshold();
		t.is(retrieved, 2000);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updatePasteThreshold does not overwrite other preferences saved via savePreferences', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		// Save regular preferences first
		savePreferences({lastProvider: 'ollama', lastModel: 'llama3'});

		// Then update paste threshold
		updatePasteThreshold(400);

		// Both should coexist
		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.lastProvider, 'ollama');
		t.is(parsed.lastModel, 'llama3');
		t.is(parsed.paste?.singleLineThreshold, 400);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// Notification Preferences Tests
// ============================================================================

test.serial('getNotificationsPreference returns undefined when not set', t => {
	const preferencesPath = getTestPreferencesPath();
	writeFileSync(preferencesPath, JSON.stringify({lastProvider: 'test'}, null, 2), 'utf-8');

	try {
		const result = getNotificationsPreference();
		t.is(result, undefined);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('getNotificationsPreference returns undefined when file does not exist', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	const result = getNotificationsPreference();
	t.is(result, undefined);
});

test.serial('getNotificationsPreference returns saved config', t => {
	const preferencesPath = getTestPreferencesPath();
	const data: UserPreferences = {
		notifications: {
			enabled: true,
			sound: false,
			events: {
				toolConfirmation: true,
				questionPrompt: true,
				generationComplete: false,
			},
		},
	};
	writeFileSync(preferencesPath, JSON.stringify(data, null, 2), 'utf-8');

	try {
		const result = getNotificationsPreference();
		t.truthy(result);
		t.is(result!.enabled, true);
		t.is(result!.sound, false);
		t.is(result!.events?.toolConfirmation, true);
		t.is(result!.events?.generationComplete, false);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateNotificationsPreference saves config at top level', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateNotificationsPreference({enabled: true, sound: true});

		t.true(existsSync(preferencesPath));

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.notifications?.enabled, true);
		t.is(parsed.notifications?.sound, true);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateNotificationsPreference preserves existing preferences', t => {
	const preferencesPath = getTestPreferencesPath();
	const existingData: UserPreferences = {
		lastProvider: 'openrouter',
		selectedTheme: 'tokyo-night',
	};
	writeFileSync(preferencesPath, JSON.stringify(existingData, null, 2), 'utf-8');

	try {
		updateNotificationsPreference({enabled: false});

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.lastProvider, 'openrouter');
		t.is(parsed.selectedTheme, 'tokyo-night');
		t.is(parsed.notifications?.enabled, false);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('full workflow: update and retrieve notifications', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateNotificationsPreference({enabled: true, sound: false, timeout: 5000});
		const retrieved = getNotificationsPreference();

		t.truthy(retrieved);
		t.is(retrieved!.enabled, true);
		t.is(retrieved!.sound, false);
		t.is(retrieved!.timeout, 5000);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

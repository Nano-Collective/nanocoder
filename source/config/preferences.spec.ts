import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	DEFAULT_MEMORY_LIMIT,
	DEFAULT_TOKEN_BUDGET,
	MAX_MEMORY_LIMIT,
	MAX_TOKEN_BUDGET,
	MIN_MEMORY_LIMIT,
	MIN_TOKEN_BUDGET,
} from '@/memory/project-context';
import {
	getCompactToolDisplay,
	getLastUsedModel,
	getNanocoderShape,
	getNotificationsPreference,
	getPasteThreshold,
	getProfessionalTone,
	getProjectContextPreferences,
	getReasoningExpanded,
	getSemanticMemoryEnabled,
	loadPreferences,
	resolveProjectContextPreferences,
	resetPreferencesCache,
	savePreferences,
	getShowUsageFooter,
	updateCompactToolDisplay,
	updateLastUsed,
	updateNanocoderShape,
	updateNotificationsPreference,
	updatePasteThreshold,
	updateProfessionalTone,
	updateReasoningExpanded,
	updateSemanticMemoryEnabled,
	updateSemanticMemoryLimit,
	updateSemanticMemoryTokenBudget,
	getPrivacyPreference,
	updatePrivacyPreference,
	updateShowUsageFooter,
} from './preferences';
import {updatePreferencesNestedValue} from '@/config/config-writer';
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

test.serial('getPasteThreshold returns threshold from nanocoder.paste.singleLineThreshold', t => {
	const preferencesPath = getTestPreferencesPath();
	const data: UserPreferences = {
		lastProvider: 'openrouter',
		nanocoder: {
			paste: {
				singleLineThreshold: 1500,
			},
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
		nanocoder: {
			paste: {
				singleLineThreshold: -100,
			},
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
		nanocoder: {
			paste: {
				singleLineThreshold: 0,
			},
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
		nanocoder: {
			paste: {
				singleLineThreshold: 1234.7,
			},
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
		nanocoder: {
			paste: {
				singleLineThreshold: 'not-a-number',
			},
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

test.serial('updatePasteThreshold saves threshold to nanocoder.paste.singleLineThreshold', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updatePasteThreshold(2000);

		t.true(existsSync(preferencesPath));

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.nanocoder?.paste?.singleLineThreshold, 2000);
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
		t.is(parsed.nanocoder?.paste?.singleLineThreshold, 1500);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updatePasteThreshold overwrites existing paste threshold', t => {
	const preferencesPath = getTestPreferencesPath();
	const existingData: UserPreferences = {
		nanocoder: {
			paste: {
				singleLineThreshold: 800,
			},
		},
	};
	writeFileSync(preferencesPath, JSON.stringify(existingData, null, 2), 'utf-8');

	try {
		updatePasteThreshold(1000);

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.nanocoder?.paste?.singleLineThreshold, 1000);
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

		t.is(parsed.nanocoder?.paste?.singleLineThreshold, 1235);
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

		t.is(parsed.nanocoder?.paste?.singleLineThreshold, 500);
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
		t.is(parsed.nanocoder?.paste?.singleLineThreshold, 400);
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

// ============================================================================
// Reasoning Expanded Tests
// ============================================================================

test.serial('getReasoningExpanded returns false when not set', t => {
	const preferencesPath = getTestPreferencesPath();
	writeFileSync(preferencesPath, JSON.stringify({lastProvider: 'test'}, null, 2), 'utf-8');

	try {
		const result = getReasoningExpanded();
		t.is(result, false);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('getReasoningExpanded returns false when file does not exist', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	const result = getReasoningExpanded();
	t.is(result, false);
});

test.serial('getReasoningExpanded returns true when set', t => {
	const preferencesPath = getTestPreferencesPath();
	const data: UserPreferences = {
		reasoningExpanded: true,
	};
	writeFileSync(preferencesPath, JSON.stringify(data, null, 2), 'utf-8');

	try {
		const result = getReasoningExpanded();
		t.is(result, true);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateReasoningExpanded saves false value', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateReasoningExpanded(false);

		t.true(existsSync(preferencesPath));

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.reasoningExpanded, false);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateReasoningExpanded saves true value', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateReasoningExpanded(true);

		t.true(existsSync(preferencesPath));

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.reasoningExpanded, true);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateReasoningExpanded preserves existing preferences', t => {
	const preferencesPath = getTestPreferencesPath();
	const existingData: UserPreferences = {
		lastProvider: 'openrouter',
		selectedTheme: 'tokyo-night',
	};
	writeFileSync(preferencesPath, JSON.stringify(existingData, null, 2), 'utf-8');

	try {
		updateReasoningExpanded(true);

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.lastProvider, 'openrouter');
		t.is(parsed.selectedTheme, 'tokyo-night');
		t.is(parsed.reasoningExpanded, true);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('full workflow: update and retrieve reasoning expanded', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateReasoningExpanded(true);
		const retrieved = getReasoningExpanded();
		t.is(retrieved, true);

		updateReasoningExpanded(false);
		const retrieved2 = getReasoningExpanded();
		t.is(retrieved2, false);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// Compact Tool Display Tests
// ============================================================================

test.serial('getCompactToolDisplay returns true when not set', t => {
	const preferencesPath = getTestPreferencesPath();
	writeFileSync(preferencesPath, JSON.stringify({lastProvider: 'test'}, null, 2), 'utf-8');

	try {
		const result = getCompactToolDisplay();
		t.is(result, true);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('getCompactToolDisplay returns true when file does not exist', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	const result = getCompactToolDisplay();
	t.is(result, true);
});

test.serial('getCompactToolDisplay returns false when set', t => {
	const preferencesPath = getTestPreferencesPath();
	const data: UserPreferences = {
		compactToolDisplay: false,
	};
	writeFileSync(preferencesPath, JSON.stringify(data, null, 2), 'utf-8');

	try {
		const result = getCompactToolDisplay();
		t.is(result, false);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateCompactToolDisplay saves false value', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateCompactToolDisplay(false);

		t.true(existsSync(preferencesPath));

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.compactToolDisplay, false);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateCompactToolDisplay saves true value', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateCompactToolDisplay(true);

		t.true(existsSync(preferencesPath));

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.compactToolDisplay, true);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateCompactToolDisplay preserves existing preferences', t => {
	const preferencesPath = getTestPreferencesPath();
	const existingData: UserPreferences = {
		lastProvider: 'openrouter',
		reasoningExpanded: true,
	};
	writeFileSync(preferencesPath, JSON.stringify(existingData, null, 2), 'utf-8');

	try {
		updateCompactToolDisplay(false);

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.lastProvider, 'openrouter');
		t.is(parsed.reasoningExpanded, true);
		t.is(parsed.compactToolDisplay, false);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('full workflow: update and retrieve compact tool display', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateCompactToolDisplay(false);
		const retrieved = getCompactToolDisplay();
		t.is(retrieved, false);

		updateCompactToolDisplay(true);
		const retrieved2 = getCompactToolDisplay();
		t.is(retrieved2, true);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// Display Settings Integration Tests
// ============================================================================

test.serial('display settings can be combined with other preferences', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		// Set reasoning expanded
		updateReasoningExpanded(true);
		// Set compact tool display
		updateCompactToolDisplay(false);

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.reasoningExpanded, true);
		t.is(parsed.compactToolDisplay, false);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('full workflow: update and retrieve all display settings', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		// Set both display settings
		updateReasoningExpanded(true);
		updateCompactToolDisplay(false);

		// Retrieve both
		const reasoningResult = getReasoningExpanded();
		const compactResult = getCompactToolDisplay();

		t.is(reasoningResult, true);
		t.is(compactResult, false);

		// Toggle both
		updateReasoningExpanded(false);
		updateCompactToolDisplay(true);

		// Verify toggles
		t.is(getReasoningExpanded(), false);
		t.is(getCompactToolDisplay(), true);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// Privacy Settings Tests
// ============================================================================

test.serial('getPrivacyPreference returns false when not set', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {};
	writeFileSync(preferencesPath, JSON.stringify(preferences), 'utf-8');

	try {
		const result = getPrivacyPreference();
		t.is(result, false);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('getPrivacyPreference returns true when set', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {enablePromptScrubbing: true};
	writeFileSync(preferencesPath, JSON.stringify(preferences), 'utf-8');

	try {
		const result = getPrivacyPreference();
		t.is(result, true);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updatePrivacyPreference saves the preference correctly', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updatePrivacyPreference(true);

		t.true(existsSync(preferencesPath));
		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.enablePromptScrubbing, true);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('full workflow: update and retrieve privacy preference', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updatePrivacyPreference(true);
		const retrieved = getPrivacyPreference();
		t.is(retrieved, true);

		updatePrivacyPreference(false);
		const retrieved2 = getPrivacyPreference();
		t.is(retrieved2, false);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// Usage Footer Tests
// ============================================================================

test.serial('getShowUsageFooter defaults to true when not set', t => {
	const preferencesPath = getTestPreferencesPath();
	writeFileSync(
		preferencesPath,
		JSON.stringify({lastProvider: 'test'}, null, 2),
		'utf-8',
	);

	try {
		t.is(getShowUsageFooter(), true);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('getShowUsageFooter defaults to true when file does not exist', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	t.is(getShowUsageFooter(), true);
});

test.serial('getShowUsageFooter returns false when explicitly disabled', t => {
	const preferencesPath = getTestPreferencesPath();
	const data: UserPreferences = {showUsageFooter: false};
	writeFileSync(preferencesPath, JSON.stringify(data, null, 2), 'utf-8');

	try {
		t.is(getShowUsageFooter(), false);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateShowUsageFooter preserves existing preferences', t => {
	const preferencesPath = getTestPreferencesPath();
	const existing: UserPreferences = {
		lastProvider: 'ollama',
		lastModel: 'qwen',
	};
	writeFileSync(preferencesPath, JSON.stringify(existing, null, 2), 'utf-8');

	try {
		updateShowUsageFooter(false);

		const parsed = JSON.parse(
			readFileSync(preferencesPath, 'utf-8'),
		) as UserPreferences;
		t.is(parsed.showUsageFooter, false);
		t.is(parsed.lastProvider, 'ollama');
		t.is(parsed.lastModel, 'qwen');
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('full workflow: toggle usage footer off and back on', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateShowUsageFooter(false);
		t.is(getShowUsageFooter(), false);

		updateShowUsageFooter(true);
		t.is(getShowUsageFooter(), true);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// professionalTone Tests
// ============================================================================

test.serial('getProfessionalTone returns false when not set', t => {
	const preferencesPath = getTestPreferencesPath();
	writeFileSync(
		preferencesPath,
		JSON.stringify({lastProvider: 'test'}, null, 2),
		'utf-8',
	);

	try {
		t.is(getProfessionalTone(), false);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateProfessionalTone persists the value', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateProfessionalTone(true);
		t.is(getProfessionalTone(), true);
		t.is(loadPreferences().professionalTone, true);

		updateProfessionalTone(false);
		t.is(getProfessionalTone(), false);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateProfessionalTone preserves other preferences', t => {
	const preferencesPath = getTestPreferencesPath();
	savePreferences({lastProvider: 'ollama', lastModel: 'qwen'});

	try {
		updateProfessionalTone(true);
		const preferences = loadPreferences();
		t.is(preferences.lastProvider, 'ollama');
		t.is(preferences.lastModel, 'qwen');
		t.is(preferences.professionalTone, true);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// Cross-writer non-clobbering: updatePreferencesNestedValue (sessions) and
// updatePasteThreshold (paste) share the same file but write via different code
// paths. Verify that writing one does not erase the other.

test.serial(
	'sessions writer does not clobber paste written by savePreferences',
	t => {
		const preferencesPath = getTestPreferencesPath();
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}

		try {
			updatePasteThreshold(1500);
			updatePreferencesNestedValue('sessions', 'maxMessages', 50);

			const content = JSON.parse(
				readFileSync(preferencesPath, 'utf-8'),
			) as UserPreferences;

			t.is(content.nanocoder?.paste?.singleLineThreshold, 1500);
			t.is(content.nanocoder?.sessions?.maxMessages, 50);
		} finally {
			if (existsSync(preferencesPath)) {
				rmSync(preferencesPath, {force: true});
			}
		}
	},
);

test.serial(
	'paste writer via savePreferences does not clobber sessions',
	t => {
		const preferencesPath = getTestPreferencesPath();
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}

		try {
			updatePreferencesNestedValue('sessions', 'retentionDays', 14);
			updatePasteThreshold(2000);

			const content = JSON.parse(
				readFileSync(preferencesPath, 'utf-8'),
			) as UserPreferences;

			t.is(content.nanocoder?.sessions?.retentionDays, 14);
			t.is(content.nanocoder?.paste?.singleLineThreshold, 2000);
		} finally {
			if (existsSync(preferencesPath)) {
				rmSync(preferencesPath, {force: true});
			}
		}
	},
);

test.serial('getSemanticMemoryEnabled returns true when not set', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {};
	writeFileSync(preferencesPath, JSON.stringify(preferences), 'utf-8');

	try {
		const result = getSemanticMemoryEnabled();
		t.is(result, true);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('getSemanticMemoryEnabled returns false when disabled', t => {
	const preferencesPath = getTestPreferencesPath();
	const preferences: UserPreferences = {semanticMemoryEnabled: false};
	writeFileSync(preferencesPath, JSON.stringify(preferences), 'utf-8');

	try {
		const result = getSemanticMemoryEnabled();
		t.is(result, false);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateSemanticMemoryEnabled saves the preference correctly', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateSemanticMemoryEnabled(false);

		t.true(existsSync(preferencesPath));
		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.semanticMemoryEnabled, false);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

// ============================================================================
// Project Context Preferences Tests (token budget + memory limit, round-4 review)
// ============================================================================

test('resolveProjectContextPreferences falls back to the shipped defaults', t => {
	t.deepEqual(resolveProjectContextPreferences({} as UserPreferences), {
		semanticMemoryEnabled: true,
		memoryLimit: DEFAULT_MEMORY_LIMIT,
		tokenBudget: DEFAULT_TOKEN_BUDGET,
	});
});

test('resolveProjectContextPreferences honours configured values', t => {
	t.deepEqual(
		resolveProjectContextPreferences({
			semanticMemoryEnabled: false,
			semanticMemoryLimit: 3,
			semanticMemoryTokenBudget: 120,
		} as UserPreferences),
		{semanticMemoryEnabled: false, memoryLimit: 3, tokenBudget: 120},
	);
});

test('resolveProjectContextPreferences clamps out-of-range values', t => {
	const tooLow = resolveProjectContextPreferences({
		semanticMemoryLimit: 0,
		semanticMemoryTokenBudget: 1,
	} as UserPreferences);
	t.is(tooLow.memoryLimit, MIN_MEMORY_LIMIT);
	t.is(tooLow.tokenBudget, MIN_TOKEN_BUDGET);

	const tooHigh = resolveProjectContextPreferences({
		semanticMemoryLimit: 10_000,
		semanticMemoryTokenBudget: 10_000,
	} as UserPreferences);
	t.is(tooHigh.memoryLimit, MAX_MEMORY_LIMIT);
	t.is(tooHigh.tokenBudget, MAX_TOKEN_BUDGET);
});

test.serial('getProjectContextPreferences reads token budget and memory limit from disk', t => {
	const preferencesPath = getTestPreferencesPath();
	const data: UserPreferences = {
		semanticMemoryEnabled: true,
		semanticMemoryLimit: 12,
		semanticMemoryTokenBudget: 480,
	};
	writeFileSync(preferencesPath, JSON.stringify(data, null, 2), 'utf-8');

	try {
		t.deepEqual(getProjectContextPreferences(), {
			semanticMemoryEnabled: true,
			memoryLimit: 12,
			tokenBudget: 480,
		});
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateSemanticMemoryLimit saves a clamped value', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateSemanticMemoryLimit(500);

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.semanticMemoryLimit, MAX_MEMORY_LIMIT);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('updateSemanticMemoryTokenBudget saves a clamped value', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateSemanticMemoryTokenBudget(1);

		const content = readFileSync(preferencesPath, 'utf-8');
		const parsed = JSON.parse(content) as UserPreferences;

		t.is(parsed.semanticMemoryTokenBudget, MIN_TOKEN_BUDGET);
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

test.serial('full workflow: update and retrieve project context preferences', t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	try {
		updateSemanticMemoryLimit(5);
		updateSemanticMemoryTokenBudget(960);

		t.deepEqual(getProjectContextPreferences(), {
			semanticMemoryEnabled: true,
			memoryLimit: 5,
			tokenBudget: 960,
		});
	} finally {
		if (existsSync(preferencesPath)) {
			rmSync(preferencesPath, {force: true});
		}
	}
});

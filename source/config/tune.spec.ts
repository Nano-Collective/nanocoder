import test from 'ava';
import {resolveTune} from './tune.js';
import type {
	AIProviderConfig,
	AppConfig,
	TuneConfig,
	UserPreferences,
} from '@/types/config';
import {TUNE_DEFAULTS} from '@/types/config';

console.log('\ntune.spec.ts');

// ============================================================================
// resolveTune — default behaviour
// ============================================================================

test('resolveTune - returns hardcoded defaults when no args', t => {
	const result = resolveTune();
	t.deepEqual(result, TUNE_DEFAULTS);
});

test('resolveTune - returns hardcoded defaults when all args undefined', t => {
	const result = resolveTune(undefined, undefined, undefined, undefined);
	t.deepEqual(result, TUNE_DEFAULTS);
});

// ============================================================================
// resolveTune — config layers
// ============================================================================

test('resolveTune - applies app config top-level overrides', t => {
	const appConfig: AppConfig = {
		tune: {toolProfile: 'minimal', aggressiveCompact: true},
	};
	const result = resolveTune(appConfig);
	t.is(result.toolProfile, 'minimal');
	t.true(result.aggressiveCompact);
	t.false(result.enabled); // Not set, stays default
});

test('resolveTune - per-provider overrides app config', t => {
	const appConfig: AppConfig = {
		tune: {toolProfile: 'minimal'},
	};
	const providerConfig = {
		name: 'ollama',
		type: 'openai-compatible',
		models: ['llama3'],
		tune: {toolProfile: 'full' as const},
		config: {},
	} as AIProviderConfig;
	const result = resolveTune(appConfig, providerConfig);
	t.is(result.toolProfile, 'full'); // Provider wins
});

test('resolveTune - preferences override provider config', t => {
	const providerConfig = {
		name: 'ollama',
		type: 'openai-compatible',
		models: [],
		tune: {aggressiveCompact: true},
		config: {},
	} as AIProviderConfig;
	const prefs: UserPreferences = {
		tune: {
			enabled: true,
			toolProfile: 'minimal',
			aggressiveCompact: false,
		} as TuneConfig,
	};
	const result = resolveTune(undefined, providerConfig, prefs);
	t.false(result.aggressiveCompact); // Preferences win
	t.true(result.enabled);
});

test('resolveTune - session override has highest priority', t => {
	const prefs: UserPreferences = {
		tune: {
			enabled: true,
			toolProfile: 'minimal',
			aggressiveCompact: true,
		} as TuneConfig,
	};
	const sessionOverride: TuneConfig = {
		enabled: false,
		toolProfile: 'full',
		aggressiveCompact: false,
	};
	const result = resolveTune(undefined, undefined, prefs, sessionOverride);
	t.false(result.enabled); // Session wins
	t.is(result.toolProfile, 'full');
	t.false(result.aggressiveCompact);
});

// ============================================================================
// resolveTune — model parameters
// ============================================================================

test('resolveTune - merges model parameters from config', t => {
	const appConfig: AppConfig = {
		tune: {modelParameters: {temperature: 0.5}},
	};
	const result = resolveTune(appConfig);
	t.is(result.modelParameters?.temperature, 0.5);
});

test('resolveTune - higher layer replaces modelParameters entirely (shallow merge)', t => {
	const appConfig: AppConfig = {
		tune: {modelParameters: {temperature: 0.5, maxTokens: 4096}},
	};
	const prefs: UserPreferences = {
		tune: {
			enabled: true,
			toolProfile: 'full',
			aggressiveCompact: false,
			modelParameters: {temperature: 0.7},
		},
	};
	const result = resolveTune(appConfig, undefined, prefs);
	t.is(result.modelParameters?.temperature, 0.7);
	// maxTokens from app config is lost — shallow merge by design
	t.is(result.modelParameters?.maxTokens, undefined);
});

import {mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {resetPreferencesCache} from '@/config/preferences';
import type {CalibrationProfile} from '@/types/calibration';
import {
	clearCalibrationProfile,
	getAllCalibrationProfiles,
	getCalibrationKey,
	getCalibrationProfile,
	saveCalibrationProfile,
} from './calibration-store';

let testConfigDir: string;

test.beforeEach(() => {
	testConfigDir = join(
		tmpdir(),
		`nanocoder-calib-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(testConfigDir, {recursive: true});
	process.env.NANOCODER_CONFIG_DIR = testConfigDir;
	resetPreferencesCache();
});

test.afterEach(() => {
	try {
		rmSync(testConfigDir, {recursive: true, force: true});
	} catch {
		// Ignore cleanup errors
	}
	delete process.env.NANOCODER_CONFIG_DIR;
	resetPreferencesCache();
});

test.serial('getCalibrationKey normalizes provider and model strings', t => {
	t.is(
		getCalibrationKey('Ollama', 'Qwen2.5:7B '),
		'ollama:qwen2.5:7b',
	);
});

test.serial('saveCalibrationProfile persists and retrieves profile', t => {
	const profile: CalibrationProfile = {
		provider: 'ollama',
		model: 'qwen2.5-coder:7b',
		timestamp: Date.now(),
		overallScore: 85,
		tier: 'tier-1',
		recommendedProfile: 'full',
		recommendedToolMode: 'native',
		recommendedAggressiveCompact: false,
		testResults: [],
	};

	saveCalibrationProfile(profile);

	const retrieved = getCalibrationProfile('ollama', 'qwen2.5-coder:7b');
	t.truthy(retrieved);
	t.is(retrieved?.overallScore, 85);
	t.is(retrieved?.tier, 'tier-1');

	const all = getAllCalibrationProfiles();
	t.truthy(all['ollama:qwen2.5-coder:7b']);
});

test.serial('clearCalibrationProfile clears specific or all profiles', t => {
	saveCalibrationProfile({
		provider: 'ollama',
		model: 'model-a',
		timestamp: Date.now(),
		overallScore: 90,
		tier: 'tier-1',
		recommendedProfile: 'full',
		recommendedToolMode: 'native',
		recommendedAggressiveCompact: false,
		testResults: [],
	});

	saveCalibrationProfile({
		provider: 'ollama',
		model: 'model-b',
		timestamp: Date.now(),
		overallScore: 40,
		tier: 'tier-3',
		recommendedProfile: 'nano',
		recommendedToolMode: 'xml',
		recommendedAggressiveCompact: true,
		testResults: [],
	});

	t.truthy(getCalibrationProfile('ollama', 'model-a'));
	t.truthy(getCalibrationProfile('ollama', 'model-b'));

	clearCalibrationProfile('ollama', 'model-a');
	t.is(getCalibrationProfile('ollama', 'model-a'), undefined);
	t.truthy(getCalibrationProfile('ollama', 'model-b'));

	clearCalibrationProfile();
	t.is(getCalibrationProfile('ollama', 'model-b'), undefined);
});

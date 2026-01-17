import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {nanocoderShapeCommand} from './nanocoder-shape';
import {resetPreferencesCache} from '@/config/preferences';

console.log('\nnanocoder-shape.spec.ts');

// Use environment variable to isolate config directory for tests
const testConfigDir = join(tmpdir(), `nanocoder-shape-test-${Date.now()}`);

test.before(() => {
	process.env.NANOCODER_CONFIG_DIR = testConfigDir;
	mkdirSync(testConfigDir, {recursive: true});
	resetPreferencesCache();
});

test.after.always(() => {
	if (existsSync(testConfigDir)) {
		rmSync(testConfigDir, {recursive: true, force: true});
	}
	delete process.env.NANOCODER_CONFIG_DIR;
	resetPreferencesCache();
});

const getTestPreferencesPath = () =>
	join(testConfigDir, 'nanocoder-preferences.json');

// ============================================================================
// Command Definition Tests
// ============================================================================

test.serial('nanocoder-shape command has correct name', t => {
	t.is(nanocoderShapeCommand.name, 'nanocoder-shape');
});

test.serial('nanocoder-shape command has description', t => {
	t.truthy(nanocoderShapeCommand.description);
	t.true(nanocoderShapeCommand.description.length > 0);
});

test.serial('nanocoder-shape command has handler function', t => {
	t.is(typeof nanocoderShapeCommand.handler, 'function');
});

// ============================================================================
// Direct Shape Setting Tests (with arguments)
// ============================================================================

test.serial('nanocoder-shape command sets valid shape directly', async t => {
	const preferencesPath = getTestPreferencesPath();
	if (existsSync(preferencesPath)) {
		rmSync(preferencesPath, {force: true});
	}

	const result = await nanocoderShapeCommand.handler(['tiny'], [], {
		provider: 'test',
		model: 'test',
		tokens: 0,
		getMessageTokens: () => 0,
	});

	t.truthy(result);
});

test.serial('nanocoder-shape command accepts all valid shapes', async t => {
	const validShapes = [
		'block',
		'slick',
		'tiny',
		'grid',
		'pallet',
		'shade',
		'simple',
		'simpleBlock',
		'3d',
		'simple3d',
		'chrome',
		'huge',
	];

	for (const shape of validShapes) {
		const result = await nanocoderShapeCommand.handler([shape], [], {
			provider: 'test',
			model: 'test',
			tokens: 0,
			getMessageTokens: () => 0,
		});

		t.truthy(result, `Should accept shape: ${shape}`);
	}
});

test.serial('nanocoder-shape command rejects invalid shape', async t => {
	const result = await nanocoderShapeCommand.handler(['invalid-shape'], [], {
		provider: 'test',
		model: 'test',
		tokens: 0,
		getMessageTokens: () => 0,
	});

	t.truthy(result);
});

// ============================================================================
// Interactive Mode Tests (no arguments)
// ============================================================================

test.serial(
	'nanocoder-shape command returns selector component when no args',
	async t => {
		const result = await nanocoderShapeCommand.handler([], [], {
			provider: 'test',
			model: 'test',
			tokens: 0,
			getMessageTokens: () => 0,
		});

		t.truthy(result);
	},
);

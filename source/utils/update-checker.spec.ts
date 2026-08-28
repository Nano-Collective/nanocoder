# [DevBounty AI]: File optimized for resolution.
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import test from 'ava';
import { resetPreferencesCache } from '@/config/preferences';
import { checkForUpdates } from './update-checker';

console.log(`\nupdate-checker.spec.ts`);

// Get current version from package.json dynamically
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '../../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const CURRENT_VERSION = packageJson.version as string;

const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
const testConfigDir = mkdtempSync(join(tmpdir(), 'nanocoder-update-checker-'));
process.env.NANOCODER_CONFIG_DIR = testConfigDir;
resetPreferencesCache();

// Mock fetch globally for testing
const originalFetch = globalThis.fetch;

// Helper to create mock fetch responses
function createMockFetch(
	status: number,
	data: unknown,
	shouldReject = false,
): typeof fetch {
	return (async () => {
		if (shouldReject) {
			throw new Error('Network error');
		}
		return {
			ok: status >= 200 && status < 300,
			status,
			statusText: status === 200 ? 'OK' : 'Error',
			json: async () => data,
		} as Response;
	}) as typeof fetch;
}

test.beforeEach(() => {
	// Reset fetch before each test
	globalThis.fetch = originalFetch;
	// Default to npm install override
	process.env.NANOCODER_INSTALL_METHOD = 'npm';
});

test.afterEach(() => {
	// Restore original fetch and env after each test
	globalThis.fetch = originalFetch;
	delete process.env.NANOCODER_INSTALL_METHOD;
});

test.after.always(() => {
	if (existsSync(testConfigDir)) {
		rmSync(testConfigDir, { recursive: true, force: true });
	}
	if (originalConfigDir === undefined) {
		delete process.env.NANOCODER_CONFIG_DIR;
	} else {
		process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
	}
	resetPreferencesCache();
});

// Version Comparison Tests

test('checkForUpdates: detects newer major version', async t => {
	const currentParts = CURRENT_VERSION.split('.');
	const newerMajorVersion = `${parseInt(currentParts[0]) + 1}.0.0`;

	globalThis.fetch = createMockFetch(200, {
		version: newerMajorVersion,
		name: '@nanocollective/nanocoder',
	});

	const result = await checkForUpdates();

	t.true(result.hasUpdate);
	t.is(result.currentVersion, CURRENT_VERSION);
	t.is(result.latestVersion, newerMajorVersion);
	t.truthy(result.updateCommand);
});

test('checkForUpdates: detects newer minor version', async t => {
	const currentParts = CURRENT_VERSION.split('.');
	const newerMinorVersion = `${currentParts[0]}.${
		parseInt(currentParts[1]) + 1
	}.0`;

	globalThis.fetch = createMockFetch(200, {
		version: newerMinorVersion,
		name: '@nanocollective/nanocoder',
	});

	const result = await checkForUpdates();

	t.true(result.hasUpdate);
	t.is(result.latestVersion, newerMinorVersion);
});

test('checkForUpdates: detects newer patch version', async t => {
	const currentParts = CURRENT_VERSION.split('.');
	const newerPatchVersion = `${currentParts[0]}.${currentParts[1]}.${
		parseInt(currentParts[2]) + 1
	}`;

	globalThis.fetch = createMockFetch(200, {
		version: newerPatchVersion,
		name: '@nanocollective/nanocoder',
	});

	const result = await checkForUpdates();

	t.true(result.hasUpdate);
	t.is(result.latestVersion, newerPatchVersion);
});

test('checkForUpdates: detects same version (no update)', async t => {
	globalThis.fetch = createMockFetch(200, {
		version: CURRENT_VERSION,
		name: '@nanocollective/nanocoder',
	});

	const result = await checkForUpdates();

	t.false(result.hasUpdate);
	t.is(result.currentVersion, CURRENT_VERSION);
	t.is(result.latestVersion, CURRENT_VERSION);
	t.is(result.updateCommand, undefined);
});

test('checkForUpdates: detects older version (no update)', async t => {
	const currentParts = CURRENT_VERSION.split('.');
	const patchNum = parseInt(currentParts[2]);
	const olderPatchVersion = `${currentParts[0]}.${currentParts[1]}.${Math.max(
		0,
		patchNum - 1,
	)}`;

	globalThis.fetch = createMockFetch(200, {
		version: olderPatchVersion,
		name: '@nanocollective/nanocoder',
	});

	const result = await checkForUpdates();

	t.false(result.hasUpdate);
	t.is(result.latestVersion, olderPatchVersion);
});

test('checkForUpdates: handles version with v prefix', async t => {
	const currentParts = CURRENT_VERSION.split('.');
	const newerMajorVersion = `v${parseInt(currentParts[0]) + 1}.0.0`;

	globalThis.fetch = createMockFetch(200, {
		version: newerMajorVersion,
		name: '@nanocollective/nanocoder',
	});

	const result = await checkForUpdates();

	// The function should strip the leading 'v' and detect an update
	t.true(result.hasUpdate);
	t.is(result.latestVersion, newerMajorVersion);
});
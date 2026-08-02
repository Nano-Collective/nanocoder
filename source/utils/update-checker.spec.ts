import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'fs';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';
import {tmpdir} from 'os';
import test from 'ava';
import {resetPreferencesCache} from '@/config/preferences';
import {checkForUpdates} from './update-checker';

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
		rmSync(testConfigDir, {recursive: true, force: true});
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
	// Calculate a newer major version dynamically
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
	// Calculate a newer minor version dynamically
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
	// Calculate a newer patch version dynamically
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
	// Calculate an older patch version dynamically
	const currentParts = CURRENT_VERSION.split('.');
	const patchNum = parseInt(currentParts[2]);
	// Use 0 if current patch is already 0, otherwise decrement
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
	// Use a newer major version with v prefix
	const currentParts = CURRENT_VERSION.split('.');
	const newerMajorVersion = `v${parseInt(currentParts[0]) + 1}.0.0`;

	globalThis.fetch = createMockFetch(200, {
		version: newerMajorVersion,
		name: '@nanocollective/nanocoder',
	});

	const result = await checkForUpdates();

	t.true(result.hasUpdate);
	t.is(result.latestVersion, newerMajorVersion);
});

test('checkForUpdates: handles pre-release versions', async t => {
	// Use a newer major version with pre-release tag
	const currentParts = CURRENT_VERSION.split('.');
	const newerPreReleaseVersion = `${parseInt(currentParts[0]) + 1}.0.0-beta.1`;

	globalThis.fetch = createMockFetch(200, {
		version: newerPreReleaseVersion,
		name: '@nanocollective/nanocoder',
	});

	const result = await checkForUpdates();

	// Pre-release info is stripped during comparison
	t.true(result.hasUpdate);
	t.is(result.latestVersion, newerPreReleaseVersion);
});

// Network Error Handling Tests

test('checkForUpdates: handles network errors gracefully', async t => {
	globalThis.fetch = createMockFetch(200, {}, true);

	const result = await checkForUpdates();

	t.false(result.hasUpdate);
	t.truthy(result.currentVersion);
	t.is(result.latestVersion, undefined);
});

test('checkForUpdates: handles HTTP 404 error', async t => {
	globalThis.fetch = createMockFetch(404, {
		error: 'Not found',
	});

	const result = await checkForUpdates();

	t.false(result.hasUpdate);
	t.truthy(result.currentVersion);
});

test('checkForUpdates: handles HTTP 500 error', async t => {
	globalThis.fetch = createMockFetch(500, {
		error: 'Internal server error',
	});

	const result = await checkForUpdates();

	t.false(result.hasUpdate);
	t.truthy(result.currentVersion);
});

test('checkForUpdates: preserves timestamp when version fetch fails', async t => {
	const preferencesPath = join(testConfigDir, 'nanocoder-preferences.json');
	const previousTimestamp = 1234567890;
	writeFileSync(
		preferencesPath,
		JSON.stringify({lastUpdateCheck: previousTimestamp}),
	);

	globalThis.fetch = createMockFetch(503, {
		error: 'Service unavailable',
	});

	const result = await checkForUpdates();
	const preferences = JSON.parse(readFileSync(preferencesPath, 'utf-8')) as {
		lastUpdateCheck?: number;
	};

	t.false(result.hasUpdate);
	t.is(preferences.lastUpdateCheck, previousTimestamp);
});

test('checkForUpdates: handles timeout (via AbortSignal)', async t => {
	// Simulate timeout by throwing AbortError
	globalThis.fetch = (async () => {
		const error = new Error('The operation was aborted');
		error.name = 'AbortError';
		throw error;
	}) as typeof fetch;

	const result = await checkForUpdates();

	// Should handle timeout gracefully
	t.false(result.hasUpdate);
});

// Response Format Tests

test('checkForUpdates: returns correct update command', async t => {
	globalThis.fetch = createMockFetch(200, {
		version: '2.0.0',
		name: '@nanocollective/nanocoder',
	});

	const result = await checkForUpdates();

	t.is(result.updateCommand, 'npm update -g @nanocollective/nanocoder');
});

test('checkForUpdates: returns correct Homebrew command when installed via Homebrew', async t => {
	globalThis.fetch = createMockFetch(200, {
		version: '2.0.0',
		name: '@nanocollective/nanocoder',
	});

	process.env.NANOCODER_INSTALL_METHOD = 'homebrew';

	const result = await checkForUpdates();

	t.is(
		result.updateCommand,
		'brew list nanocoder >/dev/null 2>&1 && brew upgrade nanocoder || (echo "Error: nanocoder not found in Homebrew. Please install it first with: brew install nanocoder" && exit 1)',
	);
});

test('checkForUpdates: returns message for Nix installations (no executable command)', async t => {
	globalThis.fetch = createMockFetch(200, {
		version: '2.0.0',
		name: '@nanocollective/nanocoder',
	});

	process.env.NANOCODER_INSTALL_METHOD = 'nix';

	const result = await checkForUpdates();

	t.is(
		result.updateMessage,
		'To update, re-run: nix run github:Nano-Collective/nanocoder (or update your flake).',
	);
});

test('checkForUpdates: includes current version in response', async t => {
	globalThis.fetch = createMockFetch(200, {
		version: '2.0.0',
		name: '@nanocollective/nanocoder',
	});

	const result = await checkForUpdates();

	t.truthy(result.currentVersion);
	t.regex(result.currentVersion, /^\d+\.\d+\.\d+/);
});

test('checkForUpdates: handles missing version field in response', async t => {
	globalThis.fetch = createMockFetch(200, {
		name: '@nanocollective/nanocoder',
		// version field missing
	});

	const result = await checkForUpdates();

	t.false(result.hasUpdate);
});

test('checkForUpdates: handles malformed JSON response', async t => {
	globalThis.fetch = (async () => {
		return {
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => {
				throw new Error('Invalid JSON');
			},
		} as unknown as Response;
	}) as typeof fetch;

	const result = await checkForUpdates();

	t.false(result.hasUpdate);
});

// Edge Cases

test('checkForUpdates: handles empty version string', async t => {
	globalThis.fetch = createMockFetch(200, {
		version: '',
		name: '@nanocollective/nanocoder',
	});

	const result = await checkForUpdates();

	t.false(result.hasUpdate);
});

test('checkForUpdates: handles version with extra segments', async t => {
	globalThis.fetch = createMockFetch(200, {
		version: '2.0.0.1',
		name: '@nanocollective/nanocoder',
	});

	const result = await checkForUpdates();

	// Should compare first 3 segments
	t.true(result.hasUpdate);
});

test('checkForUpdates: handles invalid version format', async t => {
	globalThis.fetch = createMockFetch(200, {
		version: 'not-a-version',
		name: '@nanocollective/nanocoder',
	});

	const result = await checkForUpdates();

	// Should handle gracefully
	t.false(result.hasUpdate);
});

// Integration Tests

test('checkForUpdates: complete workflow for update available', async t => {
	globalThis.fetch = createMockFetch(200, {
		version: '99.99.99',
		name: '@nanocollective/nanocoder',
	});

	const result = await checkForUpdates();

	t.true(result.hasUpdate);
	t.truthy(result.currentVersion);
	t.is(result.latestVersion, '99.99.99');
	t.is(result.updateCommand, 'npm update -g @nanocollective/nanocoder');
});

test('checkForUpdates: complete workflow for no update', async t => {
	globalThis.fetch = createMockFetch(200, {
		version: '0.0.1',
		name: '@nanocollective/nanocoder',
	});

	const result = await checkForUpdates();

	t.false(result.hasUpdate);
	t.truthy(result.currentVersion);
	t.is(result.latestVersion, '0.0.1');
	t.is(result.updateCommand, undefined);
});

test('checkForUpdates: complete workflow for network failure', async t => {
	globalThis.fetch = createMockFetch(200, {}, true);

	const result = await checkForUpdates();

	t.false(result.hasUpdate);
	t.truthy(result.currentVersion);
	t.is(result.latestVersion, undefined);
	t.is(result.updateCommand, undefined);
});

// Tests for uncovered error paths

test('checkForUpdates: returns generic message for unknown installation method', async t => {
	// Tests lines 156-157: default case in getUpdateDetails
	globalThis.fetch = createMockFetch(200, {
		version: '2.0.0',
		name: '@nanocollective/nanocoder',
	});

	// Set to 'unknown' - a valid installation method that triggers the generic message
	// 'unknown' is a valid value in the InstallationMethod type
	process.env.NANOCODER_INSTALL_METHOD = 'unknown';

	const result = await checkForUpdates();

	t.true(result.hasUpdate);
	t.is(result.updateCommand, undefined);
	// Should return the generic unknown message
	t.is(
		result.updateMessage,
		'A new version is available. Please update using your package manager.',
	);
});

test('checkForUpdates: handles general errors in main function', async t => {
	// Tests lines 171-181: catch block in checkForUpdates
	// Make fetch throw a non-network error to hit the catch block
	globalThis.fetch = (async () => {
		throw new Error('Unexpected error during fetch');
	}) as typeof fetch;

	const result = await checkForUpdates();

	// Should handle error gracefully
	t.false(result.hasUpdate);
	t.truthy(result.currentVersion);
});

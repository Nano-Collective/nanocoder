import test from 'ava';
import {
	detectFromEnv,
	detectFromPath,
	detectInstallationMethod,
} from './installation-detector';

console.log(`\ninstallation-detector.spec.ts`);

test.beforeEach(() => {
	// Clean up environment variables before each test
	delete process.env.NANOCODER_INSTALL_METHOD;
	delete process.env.npm_config_prefix;
	delete process.env.npm_config_global;
	delete process.env.PNPM_HOME;
	delete process.env.npm_execpath;
	delete process.env.HOMEBREW_PREFIX;
	delete process.env.HOMEBREW_CELLAR;
});

// Environment override tests
test('detectInstallationMethod: respects env override for npm', t => {
	process.env.NANOCODER_INSTALL_METHOD = 'npm';
	t.is(detectInstallationMethod(), 'npm');
});

test('detectInstallationMethod: respects env override for homebrew', t => {
	process.env.NANOCODER_INSTALL_METHOD = 'homebrew';
	t.is(detectInstallationMethod(), 'homebrew');
});

test('detectInstallationMethod: respects env override for nix', t => {
	process.env.NANOCODER_INSTALL_METHOD = 'nix';
	t.is(detectInstallationMethod(), 'nix');
});

test('detectInstallationMethod: respects env override for unknown', t => {
	process.env.NANOCODER_INSTALL_METHOD = 'unknown';
	t.is(detectInstallationMethod(), 'unknown');
});

// detectFromEnv tests
test('detectFromEnv: detects homebrew via HOMEBREW_PREFIX', t => {
	process.env.HOMEBREW_PREFIX = '/opt/homebrew';
	t.is(detectFromEnv(), 'homebrew');
});

test('detectFromEnv: detects homebrew via HOMEBREW_CELLAR', t => {
	process.env.HOMEBREW_CELLAR = '/opt/homebrew/Cellar';
	t.is(detectFromEnv(), 'homebrew');
});

test('detectFromEnv: detects npm via npm_config_prefix', t => {
	process.env.npm_config_prefix = '/usr/local';
	t.is(detectFromEnv(), 'npm');
});

test('detectFromEnv: detects npm via npm_config_global', t => {
	process.env.npm_config_global = 'true';
	t.is(detectFromEnv(), 'npm');
});

test('detectFromEnv: detects npm via PNPM_HOME', t => {
	process.env.PNPM_HOME = '/home/user/.local/share/pnpm';
	t.is(detectFromEnv(), 'npm');
});

test('detectFromEnv: detects npm via npm_execpath', t => {
	process.env.npm_execpath = '/usr/local/lib/node_modules/npm/bin/npm-cli.js';
	t.is(detectFromEnv(), 'npm');
});

test('detectFromEnv: npm env vars take precedence over HOMEBREW_PREFIX', t => {
	process.env.npm_config_prefix = '/usr/local';
	process.env.HOMEBREW_PREFIX = '/opt/homebrew';
	t.is(detectFromEnv(), 'npm');
});

test('detectFromEnv: returns null when no env vars set', t => {
	t.is(detectFromEnv(), null);
});

// Path Detection Tests
// These tests verify the detectFromPath function correctly identifies installation methods from paths

test('detectFromPath: detects nix from /nix/store path', t => {
	const path =
		'/nix/store/abc123-nanocoder-1.0.0/lib/node_modules/@nanocollective/nanocoder/dist';
	t.is(detectFromPath(path), 'nix');
});

test('detectFromPath: detects homebrew from Cellar path (macOS Intel)', t => {
	const path =
		'/usr/local/Cellar/nanocoder/1.0.0/libexec/lib/node_modules/@nanocollective/nanocoder/dist';
	t.is(detectFromPath(path), 'homebrew');
});

test('detectFromPath: detects homebrew from Cellar path (macOS ARM)', t => {
	const path =
		'/opt/homebrew/Cellar/nanocoder/1.0.0/libexec/lib/node_modules/@nanocollective/nanocoder/dist';
	t.is(detectFromPath(path), 'homebrew');
});

test('detectFromPath: detects homebrew from generic homebrew path', t => {
	const path = '/opt/homebrew/lib/node_modules/@nanocollective/nanocoder/dist';
	t.is(detectFromPath(path), 'homebrew');
});

test('detectFromPath: detects homebrew from Linux homebrew path', t => {
	const path =
		'/home/linuxbrew/.linuxbrew/Cellar/nanocoder/1.0.0/lib/node_modules/@nanocollective/nanocoder/dist';
	t.is(detectFromPath(path), 'homebrew');
});

test('detectFromPath: detects npm from node_modules path (global)', t => {
	const path = '/usr/local/lib/node_modules/@nanocollective/nanocoder/dist';
	t.is(detectFromPath(path), 'npm');
});

test('detectFromPath: detects npm from node_modules path (local)', t => {
	const path = '/home/user/project/node_modules/@nanocollective/nanocoder/dist';
	t.is(detectFromPath(path), 'npm');
});

test('detectFromPath: detects npm from pnpm store path', t => {
	const path =
		'/home/user/.pnpm-store/.pnpm/@nanocollective+nanocoder@1.0.0/node_modules/@nanocollective/nanocoder/dist';
	t.is(detectFromPath(path), 'npm');
});

test('detectFromPath: detects npm from .bin directory', t => {
	const path = '/usr/local/lib/node_modules/.bin/nanocoder';
	t.is(detectFromPath(path), 'npm');
});

test('detectFromPath: returns null for unrecognized paths', t => {
	const path = '/home/user/Downloads/nanocoder/dist';
	t.is(detectFromPath(path), null);
});

test('detectFromPath: detects npm from Windows AppData path', t => {
	// Windows npm global installations typically go to AppData
	const path =
		'C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\@nanocollective\\nanocoder\\dist';
	t.is(detectFromPath(path), 'npm');
});

test('detectFromPath: nix takes precedence over node_modules', t => {
	// Edge case: nix store might contain "node_modules" in the path
	const path =
		'/nix/store/abc123-nanocoder-1.0.0/lib/node_modules/@nanocollective/nanocoder/dist';
	t.is(detectFromPath(path), 'nix');
});

test('detectFromPath: homebrew takes precedence over node_modules', t => {
	// Edge case: homebrew path contains node_modules
	const path =
		'/opt/homebrew/Cellar/nanocoder/1.0.0/lib/node_modules/@nanocollective/nanocoder/dist';
	t.is(detectFromPath(path), 'homebrew');
});

// Priority tests
test('detectInstallationMethod: path detection takes precedence over env vars', t => {
	// HOMEBREW_PREFIX is set system-wide on any macOS with Homebrew,
	// but path-based detection should take priority to avoid false positives
	process.env.HOMEBREW_PREFIX = '/opt/homebrew';
	// In the test environment, the module is in node_modules, so path detection returns 'npm'
	t.is(detectInstallationMethod(), 'npm');
});

test('detectInstallationMethod: ignores invalid env override and continues detection', t => {
	// Set an invalid value
	process.env.NANOCODER_INSTALL_METHOD = 'invalid-method';

	// Should fall back to normal detection (ignoring invalid env var)
	// and return a valid installation method
	const result = detectInstallationMethod();

	// Should still return a valid installation method after warning
	// (will be detected from the actual running environment - npm in this case since we're in node_modules)
	t.true(
		['npm', 'homebrew', 'nix', 'unknown'].includes(result),
		`Should return valid installation method when invalid env var is set, got: ${result}`,
	);

	// Note: A warning is logged when an invalid env var is provided (visible in test output)
	// but we don't assert on logging behavior here due to the complexity of mocking
	// the structured logging system in tests. The warning is verified manually by inspecting
	// test output which shows: "Invalid NANOCODER_INSTALL_METHOD: invalid-method"
});

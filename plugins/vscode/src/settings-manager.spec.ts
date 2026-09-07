import test from 'ava';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { SettingsManager } from './settings-manager';

// Create a mock output channel
const mockOutputChannel = {
	appendLine: (msg: string) => {},
};

test.serial('SettingsManager - getConfigPaths resolves project paths correctly', (t) => {
	const manager = new SettingsManager(mockOutputChannel);
	const cwd = process.cwd(); // mock cwd
	const paths = manager.getConfigPaths(cwd);

	t.is(typeof paths.agentsConfig, 'string');
	t.is(typeof paths.preferences, 'string');
	t.is(typeof paths.mcpConfig, 'string');
	t.is(path.basename(paths.mcpConfig), '.mcp.json');
});

test.serial('SettingsManager - returns fallback values for empty or missing config', (t) => {
	const manager = new SettingsManager(mockOutputChannel);
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-test-'));
	
	// Create a dummy SettingsManager that uses this temp dir as cwd and global dir
	// We'll override getGlobalConfigDir to point to tempDir to avoid reading real configs
	const anyManager = manager as any;
	anyManager.getGlobalConfigDir = () => tempDir;

	const settings = withoutMcpEnv(() => manager.readSettings(tempDir));
	t.deepEqual(settings.providers, []);
	t.deepEqual(settings.mcpServers, []);
	t.deepEqual(settings.alwaysAllow, []);
	t.is(settings.defaultMode, null);
	t.is(settings.autoCompact.enabled, true);
	t.is(settings.autoCompact.threshold, 60);
	t.is(settings.autoCompact.mode, 'conservative');
	t.is(settings.reasoningTraces, false);
	t.is(settings.sessions.autoSave, true);
	t.is(settings.webSearch.configured, false);
	
	fs.rmSync(tempDir, { recursive: true, force: true });
});

// ── MCP servers ───────────────────────────────────────────
// MCP config lives in .mcp.json, never agents.config.json. Reading the wrong
// file is invisible in the UI — it just renders "No MCP servers configured".

/** Run `fn` with the MCP env vars cleared, so the ambient shell can't leak in. */
function withoutMcpEnv<T>(fn: () => T): T {
	const saved = {
		servers: process.env.NANOCODER_MCPSERVERS,
		file: process.env.NANOCODER_MCPSERVERS_FILE,
	};
	delete process.env.NANOCODER_MCPSERVERS;
	delete process.env.NANOCODER_MCPSERVERS_FILE;
	try {
		return fn();
	} finally {
		if (saved.servers !== undefined) process.env.NANOCODER_MCPSERVERS = saved.servers;
		if (saved.file !== undefined) process.env.NANOCODER_MCPSERVERS_FILE = saved.file;
	}
}

function makeManager(tempDir: string): SettingsManager {
	const manager = new SettingsManager(mockOutputChannel);
	(manager as any).getGlobalConfigDir = () => tempDir;
	return manager;
}

test.serial('SettingsManager - reads MCP servers from .mcp.json', (t) => {
	withoutMcpEnv(() => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-test-'));
		const manager = makeManager(tempDir);

		fs.writeFileSync(path.join(tempDir, '.mcp.json'), JSON.stringify({
			mcpServers: {
				filesystem: { transport: 'stdio', command: 'npx', args: ['-y', 'server'] },
				remote: { transport: 'http', url: 'https://example.com/mcp' },
			},
		}));

		const settings = manager.readSettings(tempDir);
		t.deepEqual(settings.mcpServers, [
			{ name: 'filesystem', transport: 'stdio', command: 'npx', url: undefined },
			{ name: 'remote', transport: 'http', command: undefined, url: 'https://example.com/mcp' },
		]);

		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});

test.serial('SettingsManager - ignores mcpServers in agents.config.json', (t) => {
	withoutMcpEnv(() => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-test-'));
		const manager = makeManager(tempDir);

		// The old (wrong) location. The CLI never reads this, so neither do we.
		fs.writeFileSync(path.join(tempDir, 'agents.config.json'), JSON.stringify({
			nanocoder: { mcpServers: [{ name: 'ghost', transport: 'stdio', command: 'x' }] },
		}));

		const settings = manager.readSettings(tempDir);
		t.deepEqual(settings.mcpServers, []);

		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});

test.serial('SettingsManager - infers transport when .mcp.json omits it', (t) => {
	withoutMcpEnv(() => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-test-'));
		const manager = makeManager(tempDir);

		fs.writeFileSync(path.join(tempDir, '.mcp.json'), JSON.stringify({
			mcpServers: {
				local: { command: 'npx' },
				hosted: { url: 'https://example.com/mcp' },
			},
		}));

		const settings = manager.readSettings(tempDir);
		t.is(settings.mcpServers[0].transport, 'stdio');
		t.is(settings.mcpServers[1].transport, 'http');

		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});

test.serial('SettingsManager - NANOCODER_MCPSERVERS takes precedence over .mcp.json', (t) => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-test-'));
	const manager = makeManager(tempDir);
	const saved = process.env.NANOCODER_MCPSERVERS;

	fs.writeFileSync(path.join(tempDir, '.mcp.json'), JSON.stringify({
		mcpServers: { shared: { transport: 'stdio', command: 'from-file' } },
	}));
	process.env.NANOCODER_MCPSERVERS = JSON.stringify([
		{ name: 'shared', transport: 'stdio', command: 'from-env' },
	]);

	try {
		const settings = manager.readSettings(tempDir);
		t.is(settings.mcpServers.length, 1);
		t.is(settings.mcpServers[0].command, 'from-env');
	} finally {
		if (saved === undefined) delete process.env.NANOCODER_MCPSERVERS;
		else process.env.NANOCODER_MCPSERVERS = saved;
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test.serial('SettingsManager - malformed .mcp.json yields no servers', (t) => {
	withoutMcpEnv(() => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-test-'));
		const manager = makeManager(tempDir);

		fs.writeFileSync(path.join(tempDir, '.mcp.json'), '{ not json');

		const settings = manager.readSettings(tempDir);
		t.deepEqual(settings.mcpServers, []);

		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});

test.serial('SettingsManager - updates setting correctly (atomic write)', (t) => {
	const manager = new SettingsManager(mockOutputChannel);
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-test-'));
	const anyManager = manager as any;
	anyManager.getGlobalConfigDir = () => tempDir;

	// Initial write
	const result = manager.updateSetting(tempDir, 'defaultMode', 'yolo');
	t.is(result.success, true);

	// Verify file was written
	const agentsConfigPath = path.join(tempDir, 'agents.config.json');
	t.is(fs.existsSync(agentsConfigPath), true);
	
	// Verify content
	const content = JSON.parse(fs.readFileSync(agentsConfigPath, 'utf8'));
	t.is(content.nanocoder.defaultMode, 'yolo');

	// Verify readSettings picks it up
	const settings = manager.readSettings(tempDir);
	t.is(settings.defaultMode, 'yolo');

	fs.rmSync(tempDir, { recursive: true, force: true });
});

test.serial('SettingsManager - handles invalid JSON gracefully on read', (t) => {
	const manager = new SettingsManager(mockOutputChannel);
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-test-'));
	const anyManager = manager as any;
	anyManager.getGlobalConfigDir = () => tempDir;

	const agentsConfigPath = path.join(tempDir, 'agents.config.json');
	fs.writeFileSync(agentsConfigPath, '{ invalid: json }'); // Syntax error

	const settings = manager.readSettings(tempDir);
	t.is(settings.defaultMode, null); // Falls back to default gracefully
	
	fs.rmSync(tempDir, { recursive: true, force: true });
});

test.serial('SettingsManager - prevents update when JSON is invalid', (t) => {
	const manager = new SettingsManager(mockOutputChannel);
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-test-'));
	const anyManager = manager as any;
	anyManager.getGlobalConfigDir = () => tempDir;

	const agentsConfigPath = path.join(tempDir, 'agents.config.json');
	fs.writeFileSync(agentsConfigPath, '{ invalid: json }'); // Syntax error

	const result = manager.updateSetting(tempDir, 'defaultMode', 'yolo');
	t.is(result.success, false);
	t.regex(result.error || '', /invalid JSON/);

	fs.rmSync(tempDir, { recursive: true, force: true });
});

test.serial('SettingsManager - validates defaultMode values', (t) => {
	const manager = new SettingsManager(mockOutputChannel);
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-test-'));
	const anyManager = manager as any;
	anyManager.getGlobalConfigDir = () => tempDir;

	// Invalid value
	const result = manager.updateSetting(tempDir, 'defaultMode', 'chat');
	t.is(result.success, false);
	t.regex(result.error || '', /Invalid defaultMode/);

	// Invalid type
	const result2 = manager.updateSetting(tempDir, 'defaultMode', 123);
	t.is(result2.success, false);
	t.regex(result2.error || '', /Invalid defaultMode value type/);

	// Valid value
	const result3 = manager.updateSetting(tempDir, 'defaultMode', 'yolo');
	t.is(result3.success, true);

	fs.rmSync(tempDir, { recursive: true, force: true });
});

test.serial('SettingsManager - validates autoCompact.threshold values', (t) => {
	const manager = new SettingsManager(mockOutputChannel);
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-test-'));
	const anyManager = manager as any;
	anyManager.getGlobalConfigDir = () => tempDir;

	// Invalid type
	const result = manager.updateSetting(tempDir, 'autoCompact.threshold', 'high');
	t.is(result.success, false);
	t.regex(result.error || '', /must be a number/);

	// Valid value is clamped
	const result2 = manager.updateSetting(tempDir, 'autoCompact.threshold', 200);
	t.is(result2.success, true);

	const settings = manager.readSettings(tempDir);
	t.is(settings.autoCompact.threshold, 95); // clamped to max 95

	fs.rmSync(tempDir, { recursive: true, force: true });
});

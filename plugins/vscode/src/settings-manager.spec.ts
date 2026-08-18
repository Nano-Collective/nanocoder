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
});

test.serial('SettingsManager - returns fallback values for empty or missing config', (t) => {
	const manager = new SettingsManager(mockOutputChannel);
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-test-'));
	
	// Create a dummy SettingsManager that uses this temp dir as cwd and global dir
	// We'll override getGlobalConfigDir to point to tempDir to avoid reading real configs
	const anyManager = manager as any;
	anyManager.getGlobalConfigDir = () => tempDir;

	const settings = manager.readSettings(tempDir);
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

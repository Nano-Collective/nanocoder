import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import React from 'react';

// CRITICAL: point config reads at a temp dir BEFORE the panel's @/config/index
// import chain loads, so this spec never reads the developer's real config.
// The servers must live in a *project* .mcp.json: loadAllMCPConfigs skips
// global servers entirely when NODE_ENV is 'test' (which AVA sets).
const configDir = mkdtempSync(join(tmpdir(), 'nanocoder-spec-'));
process.env.NANOCODER_CONFIG_DIR = configDir;
// AVA runs each spec file in its own process (workerThreads: false), so this
// chdir cannot leak into another spec and needs no restore hook.
process.chdir(configDir);
writeFileSync(
	join(configDir, '.mcp.json'),
	JSON.stringify({
		mcpServers: {
			filesystem: {command: 'mcp-fs', args: []},
			github: {command: 'mcp-gh', args: []},
		},
	}),
);

const {reloadAppConfig} = await import('@/config/index');
reloadAppConfig();

const {renderWithTheme: render} = await import(
	'../../test-utils/render-with-theme'
);
const {SettingsMcpListPanel} = await import('./settings-mcp-list');

console.log(`\nsettings-mcp-list.spec.tsx – ${React.version}`);

test('lists every configured MCP server as its own row', t => {
	const {lastFrame} = render(
		<SettingsMcpListPanel onBack={() => {}} onCancel={() => {}} />,
	);

	const output = lastFrame()!;
	t.regex(output, /filesystem/);
	t.regex(output, /github/);
});

test('offers an explicit add row separate from the server rows', t => {
	const {lastFrame} = render(
		<SettingsMcpListPanel onBack={() => {}} onCancel={() => {}} />,
	);

	const output = lastFrame()!;
	// The old panel had a single "+ Add or edit MCP servers…" row and every
	// server row opened that same generic flow.
	t.regex(output, /\+ Add an MCP server/);
	t.notRegex(output, /Add or edit MCP servers/);
});

test('tells the user that Enter acts on the selected server', t => {
	const {lastFrame} = render(
		<SettingsMcpListPanel onBack={() => {}} onCancel={() => {}} />,
	);

	t.regex(lastFrame()!, /edits or deletes the selected server/);
});

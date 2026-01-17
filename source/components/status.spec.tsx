import test from 'ava';
import React from 'react';
import {themes} from '../config/themes';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import Status from './status';

console.log('\nstatus.spec.tsx');

// Default props for testing
const defaultProps = {
	provider: 'openrouter',
	model: 'anthropic/claude-3-opus',
	theme: 'tokyo-night' as const,
};

// ============================================================================
// Narrow Terminal Tests
// ============================================================================

test('Status renders narrow layout without crashing', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
			/>
	);

	t.truthy(lastFrame());

	process.stdout.columns = originalColumns;
});

test('Status shows CWD in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /CWD:/);
	t.regex(output!, new RegExp(process.cwd().slice(-20))); // Partial match

	process.stdout.columns = originalColumns;
});

test('Status shows model in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				model="test-model"
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Model:/);
	t.regex(output!, /test-model/);

	process.stdout.columns = originalColumns;
});

test('Status shows theme in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(
		<Status
			{...defaultProps}
			theme="tokyo-night"
			confDirMap={{
				'agents.config.json': '/mock/path/agents.config.json',
				'nanocoder-preferences.json': '/mock/path/nanocoder-preferences.json'
			}}
		/>,
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Theme:/);
	t.regex(output!, /Tokyo Night/);

	process.stdout.columns = originalColumns;
});

test('Status shows AGENTS.md status in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	// Test without AGENTS.md (default)
	const {lastFrame: frame1} = renderWithTheme(
		<Status
			{...defaultProps}
			agentsMdLoaded={false}
			confDirMap={{
				'agents.config.json': '/mock/path/agents.config.json',
				'nanocoder-preferences.json': '/mock/path/nanocoder-preferences.json'
			}}
		/>,
	);
	const output1 = frame1();
	t.truthy(output1);
	t.regex(output1!, /✗ No AGENTS\.md/);

	process.stdout.columns = originalColumns;
});

test('Status shows preferences loaded in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				preferencesLoaded={true}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /✓ Preferences loaded/);

	process.stdout.columns = originalColumns;
});

test('Status shows custom commands count in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				customCommandsCount={5}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /✓ 5 custom commands/);

	process.stdout.columns = originalColumns;
});

test('Status does not show custom commands when count is 0', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				customCommandsCount={0}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	// Should not show custom commands count when 0
	t.false(output!.includes('0 custom commands'));

	process.stdout.columns = originalColumns;
});

test('Status shows MCP status in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const mcpStatus = [
		{name: 'server1', status: 'connected'},
		{name: 'server2', status: 'connected'},
	];

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				mcpServersStatus={mcpStatus}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /✓ MCP: 2\/2 connected/);

	process.stdout.columns = originalColumns;
});

test('Status shows partial MCP connection in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const mcpStatus = [
		{name: 'server1', status: 'connected'},
		{name: 'server2', status: 'failed', errorMessage: 'Connection refused'},
	];

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				mcpServersStatus={mcpStatus}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /MCP: 1\/2 connected/);

	process.stdout.columns = originalColumns;
});

test('Status shows LSP status in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const lspStatus = [
		{name: 'python', status: 'connected'},
		{name: 'typescript', status: 'connected'},
	];

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				lspServersStatus={lspStatus}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /✓ LSP: 2\/2 connected/);

	process.stdout.columns = originalColumns;
});

test('Status shows update info in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const updateInfo = {
		hasUpdate: true,
		currentVersion: '1.0.0',
		latestVersion: '1.1.0',
		updateCommand: 'npm install -g @nanocollective/nanocoder',
	};

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				updateInfo={updateInfo}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /⚠ v1\.0\.0 → v1\.1\.0/);
	t.regex(output!, /Run: \/update or/);

	process.stdout.columns = originalColumns;
});

test('Status shows update message when no command in narrow layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 50;

	const updateInfo = {
		hasUpdate: true,
		currentVersion: '1.0.0',
		latestVersion: '1.1.0',
		updateMessage: 'Please update manually',
	};

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				updateInfo={updateInfo}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Please update manually/);

	process.stdout.columns = originalColumns;
});

// ============================================================================
// Normal/Wide Terminal Tests
// ============================================================================

test('Status renders normal layout with TitledBox', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Status/); // TitledBox title
	t.regex(output!, /│/); // Border characters

	process.stdout.columns = originalColumns;
});

test('Status shows provider in normal layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				provider="test-provider"
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Provider:/);
	t.regex(output!, /test-provider/);

	process.stdout.columns = originalColumns;
});

test('Status shows config path in normal layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Config:/);
	// Config path should be shown

	process.stdout.columns = originalColumns;
});

test('Status shows AGENTS.md message in normal layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				agentsMdLoaded={true}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Using AGENTS\.md/);

	process.stdout.columns = originalColumns;
});

test('Status shows no AGENTS.md message in normal layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				agentsMdLoaded={false}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /No AGENTS\.md file found/);
	t.regex(output!, /\/init/);

	process.stdout.columns = originalColumns;
});

test('Status shows custom commands loaded in normal layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				customCommandsCount={3}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /✓ 3 custom commands loaded/);

	process.stdout.columns = originalColumns;
});

test('Status shows failed MCP servers in normal layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const mcpStatus = [
		{name: 'server1', status: 'connected'},
		{name: 'server2', status: 'failed', errorMessage: 'Timeout'},
		{name: 'server3', status: 'failed', errorMessage: 'Auth failed'},
	];

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				mcpServersStatus={mcpStatus}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /MCP: 1\/3 connected/);
	t.regex(output!, /• server2: Timeout/);
	t.regex(output!, /• server3: Auth failed/);

	process.stdout.columns = originalColumns;
});

test('Status shows failed LSP servers in normal layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const lspStatus = [
		{name: 'python', status: 'connected'},
		{name: 'rust', status: 'failed', errorMessage: 'Not found'},
	];

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				lspServersStatus={lspStatus}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /LSP: 1\/2 connected/);
	t.regex(output!, /• rust: Not found/);

	process.stdout.columns = originalColumns;
});

test('Status handles no MCP servers', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				mcpServersStatus={[]}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	// Should not show MCP status when empty
	t.false(output!.includes('MCP:'));

	process.stdout.columns = originalColumns;
});

test('Status handles no LSP servers', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				lspServersStatus={[]}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	// Should not show LSP status when empty
	t.false(output!.includes('LSP:'));

	process.stdout.columns = originalColumns;
});

test('Status handles undefined MCP/LSP status', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	// Should render without errors when status is undefined

	process.stdout.columns = originalColumns;
});

// ============================================================================
// Update Info Tests
// ============================================================================

test('Status handles update info with command in normal layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const updateInfo = {
		hasUpdate: true,
		currentVersion: '1.0.0',
		latestVersion: '2.0.0',
		updateCommand: 'npm update',
	};

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				updateInfo={updateInfo}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Update Available:/);
	t.regex(output!, /v1\.0\.0 → v2\.0\.0/);
	t.regex(output!, /\/update or npm update/);

	process.stdout.columns = originalColumns;
});

test('Status handles update info with message in normal layout', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const updateInfo = {
		hasUpdate: true,
		currentVersion: '1.0.0',
		latestVersion: '2.0.0',
		updateMessage: 'Check the website for updates',
	};

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				updateInfo={updateInfo}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /Check the website for updates/);

	process.stdout.columns = originalColumns;
});

test('Status handles null updateInfo', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				updateInfo={null}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	// Should render without errors
	t.notRegex(output!, /Update Available/);

	process.stdout.columns = originalColumns;
});

test('Status handles undefined updateInfo', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /Update Available/);

	process.stdout.columns = originalColumns;
});

test('Status handles updateInfo with hasUpdate false', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const updateInfo = {
		hasUpdate: false,
		currentVersion: '1.0.0',
		latestVersion: '1.0.0',
	};

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				updateInfo={updateInfo}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.notRegex(output!, /Update Available/);

	process.stdout.columns = originalColumns;
});

// ============================================================================
// Theme Tests
// ============================================================================

test('Status works with different themes', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const themes_to_test: Array<keyof typeof themes> = [
		'tokyo-night',
		'dracula',
		'nord-frost',
		'synthwave-84',
	];

	for (const theme of themes_to_test) {
		const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				theme={theme}
			/>,
		);

		const output = lastFrame();
		t.truthy(output);
		t.regex(output!, new RegExp(themes[theme].displayName));
	}

	process.stdout.columns = originalColumns;
});

// ============================================================================
// Edge Cases
// ============================================================================

test('Status handles undefined customCommandsCount', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				customCommandsCount={undefined}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	// Should not show custom commands when undefined

	process.stdout.columns = originalColumns;
});

test('Status handles undefined preferencesLoaded', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				preferencesLoaded={undefined}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	// Should not show preferences loaded when undefined

	process.stdout.columns = originalColumns;
});

test('Status handles undefined agentsMdLoaded', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				agentsMdLoaded={undefined}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	// Should check for file existence

	process.stdout.columns = originalColumns;
});

test('Status handles server with no error message', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const mcpStatus = [
		{name: 'server1', status: 'failed'}, // No errorMessage
	];

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				mcpServersStatus={mcpStatus}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /• server1: Connection failed/); // Should show default message

	process.stdout.columns = originalColumns;
});

test('Status handles very long model names', t => {
	const originalColumns = process.stdout.columns;
	process.stdout.columns = 80;

	const longModel = 'anthropic/claude-3-opus-very-long-model-name-that-might-truncate';

	const {lastFrame} = renderWithTheme(
			<Status
				{...defaultProps}
				model={longModel}
			/>
	);

	const output = lastFrame();
	t.truthy(output);
	// Model name should be shown (possibly truncated)

	process.stdout.columns = originalColumns;
});

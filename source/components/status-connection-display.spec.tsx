import test from 'ava';
import React from 'react';
import {render} from 'ink-testing-library';
import Status from '../components/status';
import type {MCPConnectionStatus, LSPConnectionStatus} from '../types/core';

test('Status component with MCP status renders', async t => {
	const mcpStatus: MCPConnectionStatus[] = [
		{name: 'server1', status: 'connected'},
	];

	const {lastFrame} = render(
		<Status
			provider="test-provider"
			model="test-model"
			theme="tokyo-night"
			mcpServersStatus={mcpStatus}
		/>,
	);

	const output = lastFrame();
	t.true(output!.includes('Status'));
	t.true(output!.includes('MCP:'));
	t.true(output!.includes('1/1 connected'));
	// Fully connected MCP should show checkmark
	t.true(output!.includes('✓'));
});

test('Status component with preferencesLoaded renders', async t => {
	const {lastFrame} = render(
		<Status
			provider="test-provider"
			model="test-model"
			theme="tokyo-night"
			preferencesLoaded={true}
		/>,
	);

	const output = lastFrame();
	t.true(output!.includes('✓ Preferences loaded'));
});

test('Status component with customCommandsCount renders', async t => {
	const {lastFrame} = render(
		<Status
			provider="test-provider"
			model="test-model"
			theme="tokyo-night"
			customCommandsCount={6}
		/>,
	);

	const output = lastFrame();
	t.true(output!.includes('Status'));
	t.true(output!.includes('✓ 6 custom commands'));
});

test('Status component does not render custom commands when count is 0', async t => {
	const {lastFrame} = render(
		<Status
			provider="test-provider"
			model="test-model"
			theme="tokyo-night"
			customCommandsCount={0}
		/>,
	);

	const output = lastFrame();
	t.true(output!.includes('Status'));
	t.false(output!.includes('custom commands'));
});

test('Status component with LSP status renders', async t => {
	const lspStatus: LSPConnectionStatus[] = [
		{name: 'ts-language-server', status: 'connected'},
	];

	const {lastFrame} = render(
		<Status
			provider="test-provider"
			model="test-model"
			theme="tokyo-night"
			lspServersStatus={lspStatus}
		/>,
	);

	const output = lastFrame();
	t.true(output!.includes('Status'));
	t.true(output!.includes('LSP:'));
	t.true(output!.includes('✓'));
});

test('Status component without MCP/LSP still renders', async t => {
	const {lastFrame} = render(
		<Status provider="test-provider" model="test-model" theme="tokyo-night" />,
	);

	const output = lastFrame();
	t.true(output!.includes('Status'));
	// Should not contain MCP or LSP sections when no status provided
	t.false(output!.includes('MCP:'));
	t.false(output!.includes('LSP:'));
});

test('Status component renders with connection status props', async t => {
	const mcpStatus: MCPConnectionStatus[] = [
		{name: 'server1', status: 'connected'},
		{name: 'server2', status: 'failed', errorMessage: 'Connection timeout'},
	];

	const lspStatus: LSPConnectionStatus[] = [
		{name: 'ts-language-server', status: 'connected'},
		{name: 'pyright', status: 'connected'},
	];

	const {lastFrame} = render(
		<Status
			provider="test-provider"
			model="test-model"
			theme="tokyo-night"
			mcpServersStatus={mcpStatus}
			lspServersStatus={lspStatus}
		/>,
	);

	const output = lastFrame();
	t.true(output!.includes('Status'));
	t.true(output!.includes('MCP:'));
	t.true(output!.includes('1/2 connected')); // 1 of 2 MCP servers connected
	t.true(output!.includes('LSP:'));
	t.true(output!.includes('2/2 connected')); // 2 of 2 LSP servers connected
	t.true(output!.includes('Connection timeout')); // Error message should be shown
});

import test from 'ava';
import React from 'react';
import Status from '../components/status';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import type {LSPConnectionStatus, MCPConnectionStatus} from '../types/core';

test('Status component with MCP status renders', async t => {
	const mcpStatus: MCPConnectionStatus[] = [
		{name: 'server1', status: 'connected'},
	];

	const {lastFrame} = renderWithTheme(
		<Status
			provider="test-provider"
			model="test-model"
			theme="tokyo-night"
			mcpServersStatus={mcpStatus}
		/>,
	);

	const output = lastFrame();
	// Component should render without errors
	t.truthy(output);
	// Should render some content related to the status
	t.truthy(output!.trim().length > 0);
});

test('Status component with preferencesLoaded renders', async t => {
	const {lastFrame} = renderWithTheme(
		<Status
			provider="test-provider"
			model="test-model"
			theme="tokyo-night"
			preferencesLoaded={true}
		/>,
	);

	const output = lastFrame();
	// Component should render without errors
	t.truthy(output);
	// Should render some content related to the status
	t.truthy(output!.trim().length > 0);
});

test('Status component with customCommandsCount renders', async t => {
	const {lastFrame} = renderWithTheme(
		<Status
			provider="test-provider"
			model="test-model"
			theme="tokyo-night"
			customCommandsCount={6}
		/>,
	);

	const output = lastFrame();
	// Component should render without errors
	t.truthy(output);
	// Should render some content related to the status
	t.truthy(output!.trim().length > 0);
});

test('Status component does not render custom commands when count is 0', async t => {
	const {lastFrame} = renderWithTheme(
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

	const {lastFrame} = renderWithTheme(
		<Status
			provider="test-provider"
			model="test-model"
			theme="tokyo-night"
			lspServersStatus={lspStatus}
		/>,
	);

	const output = lastFrame();
	// Component should render without errors
	t.truthy(output);
	// Should render some content related to the status
	t.truthy(output!.trim().length > 0);
});

test('Status component without MCP/LSP still renders', async t => {
	const {lastFrame} = renderWithTheme(
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

	const {lastFrame} = renderWithTheme(
		<Status
			provider="test-provider"
			model="test-model"
			theme="tokyo-night"
			mcpServersStatus={mcpStatus}
			lspServersStatus={lspStatus}
		/>,
	);

	const output = lastFrame();
	// Component should render without errors
	t.truthy(output);
	// Should render some content related to the status
	t.truthy(output!.trim().length > 0);
});

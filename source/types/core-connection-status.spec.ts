import test from 'ava';
import type {
	MCPConnectionStatus,
	LSPConnectionStatus,
	ConnectionStatus,
} from '@/types/core';

test('MCPConnectionStatus type structure', t => {
	const status: MCPConnectionStatus = {
		name: 'test-server',
		status: 'connected',
	};

	t.is(status.name, 'test-server');
	t.is(status.status, 'connected');
	t.is(status.errorMessage, undefined);
});

test('MCPConnectionStatus with error', t => {
	const status: MCPConnectionStatus = {
		name: 'failed-server',
		status: 'failed',
		errorMessage: 'Connection timeout',
	};

	t.is(status.name, 'failed-server');
	t.is(status.status, 'failed');
	t.is(status.errorMessage, 'Connection timeout');
});

test('LSPConnectionStatus type structure', t => {
	const status: LSPConnectionStatus = {
		name: 'ts-language-server',
		status: 'connected',
	};

	t.is(status.name, 'ts-language-server');
	t.is(status.status, 'connected');
	t.is(status.errorMessage, undefined);
});

test('ConnectionStatus union type', t => {
	const validStatuses: ConnectionStatus[] = ['connected', 'failed', 'pending'];

	validStatuses.forEach(status => {
		t.true(['connected', 'failed', 'pending'].includes(status));
	});
});

test('Connection status filtering', t => {
	const mcpStatuses: MCPConnectionStatus[] = [
		{name: 'server1', status: 'connected'},
		{name: 'server2', status: 'failed', errorMessage: 'Timeout'},
		{name: 'server3', status: 'pending'},
	];

	const connected = mcpStatuses.filter(s => s.status === 'connected');
	const failed = mcpStatuses.filter(s => s.status === 'failed');
	const pending = mcpStatuses.filter(s => s.status === 'pending');

	t.is(connected.length, 1);
	t.is(failed.length, 1);
	t.is(pending.length, 1);
	t.is(connected[0].name, 'server1');
	t.is(failed[0].errorMessage, 'Timeout');
	t.is(pending[0].name, 'server3');
});

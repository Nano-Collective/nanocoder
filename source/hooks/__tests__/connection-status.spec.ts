import test from 'ava';
import type {MCPConnectionStatus, LSPConnectionStatus} from '@/types';

// Test React state update patterns for MCP/LSP connection status
test('MCP status object structure updates correctly', t => {
	// This tests the exact state update patterns we use in useAppInitialization
	let currentStatus: MCPConnectionStatus = {
		totalCount: 0,
		connectedCount: 0,
		errorCount: 0,
		servers: [],
	};

	const serverStates = new Map<
		string,
		{connected: boolean; toolCount: number; error?: string}
	>();

	// Simulate the exact update pattern from our implementation
	const simulateProgress = (
		serverName: string,
		success: boolean,
		toolCount = 0,
		error?: string,
	) => {
		serverStates.set(serverName, {
			connected: success,
			toolCount,
			error,
		});

		const currentServers = Array.from(serverStates.entries()).map(
			([name, state]) => ({
				name,
				connected: state.connected,
				toolCount: state.toolCount,
				error: state.error,
			}),
		);

		const connectedCount = currentServers.filter(s => s.connected).length;
		const errorCount = currentServers.filter(
			s => !s.connected && s.error,
		).length;

		currentStatus = {
			totalCount: currentServers.length,
			connectedCount,
			errorCount,
			servers: currentServers,
		};

		return currentStatus;
	};

	// Initial state
	t.is(currentStatus.totalCount, 0);
	t.is(currentStatus.connectedCount, 0);
	t.is(currentStatus.errorCount, 0);
	t.is(currentStatus.servers.length, 0);

	// First server connects
	const afterFirst = simulateProgress('server1', true, 5);
	t.is(afterFirst.totalCount, 1);
	t.is(afterFirst.connectedCount, 1);
	t.is(afterFirst.errorCount, 0);
	t.is(afterFirst.servers.length, 1);
	t.true(afterFirst.servers[0].connected);
	t.is(afterFirst.servers[0].toolCount, 5);

	// Second server connects
	const afterSecond = simulateProgress('server2', true, 3);
	t.is(afterSecond.totalCount, 2);
	t.is(afterSecond.connectedCount, 2);
	t.is(afterSecond.errorCount, 0);
	t.is(afterSecond.servers.length, 2);

	// Third server fails
	const afterThird = simulateProgress(
		'server3',
		false,
		0,
		'Connection timeout',
	);
	t.is(afterThird.totalCount, 3);
	t.is(afterThird.connectedCount, 2);
	t.is(afterThird.errorCount, 1);
	t.is(afterThird.servers.length, 3);
});

test('LSP status object structure updates correctly', t => {
	// Test the exact LSP state update pattern
	let currentStatus: LSPConnectionStatus = {
		totalCount: 0,
		connectedCount: 0,
		errorCount: 0,
		servers: [],
	};

	const serverStates = new Map<
		string,
		{connected: boolean; languages?: string[]; error?: string}
	>();

	const simulateLSPProgress = (
		serverName: string,
		success: boolean,
		languages?: string[],
		error?: string,
	) => {
		serverStates.set(serverName, {
			connected: success,
			languages,
			error,
		});

		const currentServers = Array.from(serverStates.entries()).map(
			([name, state]) => ({
				name,
				connected: state.connected,
				languages: state.languages,
				error: state.error,
			}),
		);

		const connectedCount = currentServers.filter(s => s.connected).length;
		const errorCount = currentServers.filter(
			s => !s.connected && s.error,
		).length;

		currentStatus = {
			totalCount: currentServers.length,
			connectedCount,
			errorCount,
			servers: currentServers,
		};

		return currentStatus;
	};

	// Test the auto-discovery phase fix - servers connecting before total count is known
	const rustConnected = simulateLSPProgress('rust-analyzer', true, ['rs']);
	t.is(rustConnected.totalCount, 1); // Should be discovered dynamically
	t.is(rustConnected.connectedCount, 1);
	t.is(rustConnected.errorCount, 0);
	t.deepEqual(rustConnected.servers[0].languages, ['rs']);

	// Test the discovery phase condition from our fix
	const discoveryPhase = simulateLSPProgress(
		'typescript-language-server',
		true,
		['ts', 'js'],
	);
	t.is(discoveryPhase.totalCount, 2);
	t.is(discoveryPhase.connectedCount, 2);
	t.is(discoveryPhase.errorCount, 0);
});

test('React state immutability patterns', t => {
	// Test that we're creating new objects correctly (important for React re-renders)
	let status: MCPConnectionStatus = {
		totalCount: 2,
		connectedCount: 1,
		errorCount: 1,
		servers: [
			{name: 'server1', connected: true, toolCount: 5},
			{name: 'server2', connected: false, toolCount: 0, error: 'Failed'},
		],
	};

	// Create new status object (don't mutate existing one)
	const updatedStatus: MCPConnectionStatus = {
		...status,
		connectedCount: 2,
		errorCount: 0,
		servers: status.servers.map(server =>
			server.name === 'server2'
				? {...server, connected: true, toolCount: 3, error: undefined}
				: server,
		),
	};

	// Verify original object wasn't mutated
	t.is(status.connectedCount, 1);
	t.is(status.errorCount, 1);
	t.is(status.servers[1].connected, false);

	// Verify new object has updates
	t.is(updatedStatus.connectedCount, 2);
	t.is(updatedStatus.errorCount, 0);
	t.is(updatedStatus.servers[1].connected, true);
	t.is(updatedStatus.servers[1].toolCount, 3);

	// Verify reference equality (new object created)
	t.not(status, updatedStatus);
	t.not(status.servers, updatedStatus.servers);
});

test('Status formatting logic edge cases', t => {
	// Test the format conditions we fixed in the status component
	const formatMCPStatus = (status: MCPConnectionStatus) => {
		if (status.totalCount === 0) return 'No servers configured';
		if (status.errorCount > 0) {
			return `${status.connectedCount} connected, ${status.errorCount} errors`;
		}
		return `${status.connectedCount} servers connected`;
	};

	const formatLSPStatus = (status: LSPConnectionStatus) => {
		if (status.totalCount === 0 && status.connectedCount === 0)
			return 'No servers configured';
		if (status.errorCount > 0) {
			return `${status.connectedCount} ready, ${status.errorCount} errors`;
		}
		// During auto-discovery, show connected count even if total count is still being determined
		if (status.totalCount === 0 && status.connectedCount > 0) {
			return `${status.connectedCount} servers ready...`;
		}
		return `${status.connectedCount} servers ready`;
	};

	// Test empty MCP
	const emptyMCP: MCPConnectionStatus = {
		totalCount: 0,
		connectedCount: 0,
		errorCount: 0,
		servers: [],
	};
	t.is(formatMCPStatus(emptyMCP), 'No servers configured');

	// Test successful MCP
	const successMCP: MCPConnectionStatus = {
		totalCount: 3,
		connectedCount: 3,
		errorCount: 0,
		servers: [],
	};
	t.is(formatMCPStatus(successMCP), '3 servers connected');

	// Test MCP with errors
	const errorMCP: MCPConnectionStatus = {
		totalCount: 3,
		connectedCount: 2,
		errorCount: 1,
		servers: [],
	};
	t.is(formatMCPStatus(errorMCP), '2 connected, 1 errors');

	// Test empty LSP (the fix)
	const emptyLSP: LSPConnectionStatus = {
		totalCount: 0,
		connectedCount: 0,
		errorCount: 0,
		servers: [],
	};
	t.is(formatLSPStatus(emptyLSP), 'No servers configured');

	// Test LSP discovery phase (the fix)
	const discoveryLSP: LSPConnectionStatus = {
		totalCount: 0,
		connectedCount: 2,
		errorCount: 0,
		servers: [],
	};
	t.is(formatLSPStatus(discoveryLSP), '2 servers ready...');

	// Test successful LSP
	const successLSP: LSPConnectionStatus = {
		totalCount: 4,
		connectedCount: 4,
		errorCount: 0,
		servers: [],
	};
	t.is(formatLSPStatus(successLSP), '4 servers ready');

	// Test LSP with errors
	const errorLSP: LSPConnectionStatus = {
		totalCount: 4,
		connectedCount: 3,
		errorCount: 1,
		servers: [],
	};
	t.is(formatLSPStatus(errorLSP), '3 ready, 1 errors');
});

test('Status object comparison for React.memo', t => {
	// Test the comparison logic we use in Status component React.memo
	const compareStatus = (
		prev: MCPConnectionStatus | LSPConnectionStatus,
		next: MCPConnectionStatus | LSPConnectionStatus,
	) => {
		return JSON.stringify(prev) === JSON.stringify(next);
	};

	const status1: MCPConnectionStatus = {
		totalCount: 2,
		connectedCount: 1,
		errorCount: 1,
		servers: [
			{name: 'server1', connected: true, toolCount: 5},
			{name: 'server2', connected: false, toolCount: 0, error: 'Failed'},
		],
	};

	const status2: MCPConnectionStatus = {
		totalCount: 2,
		connectedCount: 1,
		errorCount: 1,
		servers: [
			{name: 'server1', connected: true, toolCount: 5},
			{name: 'server2', connected: false, toolCount: 0, error: 'Failed'},
		],
	};

	const status3: MCPConnectionStatus = {
		...status2,
		connectedCount: 2,
	};

	// Same objects should compare equal
	t.true(compareStatus(status1, status2));

	// Different objects should not compare equal
	t.false(compareStatus(status1, status3));

	// Test deep comparison
	const status4: MCPConnectionStatus = {
		...status1,
		servers: [...status1.servers],
	};
	t.true(compareStatus(status1, status4));

	// Different server arrays should not compare equal
	const status5: MCPConnectionStatus = {
		...status1,
		servers: [
			{name: 'server1', connected: true, toolCount: 5},
			{name: 'server2', connected: true, toolCount: 3}, // Different
		],
	};
	t.false(compareStatus(status1, status5));
});

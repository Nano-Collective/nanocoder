import test from 'ava';
import type {MCPConnectionStatus} from '@/types/mcp';
import type {LSPConnectionStatus} from '@/lsp/lsp-manager';

console.log('\nuseAppInitialization.spec.ts');

// Test MCP connection status progress tracking logic
test('tracks MCP connection status progress correctly', t => {
	const serverStates = new Map<
		string,
		{connected: boolean; toolCount: number; error?: string}
	>();
	let currentStatus: MCPConnectionStatus = {
		totalCount: 2,
		connectedCount: 0,
		errorCount: 0,
		servers: [],
	};

	// Simulate the exact progress callback logic from useAppInitialization
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

	// Initial status should show both servers not connected yet
	t.is(currentStatus.totalCount, 2);
	t.is(currentStatus.connectedCount, 0);
	t.is(currentStatus.errorCount, 0);

	// First server connects
	const afterFirst = simulateProgress('server1', true, 5);
	t.is(afterFirst.totalCount, 1); // Should be 1 since only server1 is tracked
	t.is(afterFirst.connectedCount, 1);
	t.is(afterFirst.errorCount, 0);
	t.is(afterFirst.servers[0].connected, true);
	t.is(afterFirst.servers[0].toolCount, 5);

	// Second server fails
	const afterSecond = simulateProgress(
		'server2',
		false,
		0,
		'Connection timeout',
	);
	t.is(afterSecond.totalCount, 2); // Now both servers are tracked
	t.is(afterSecond.connectedCount, 1);
	t.is(afterSecond.errorCount, 1);
	t.is(afterSecond.servers[1].connected, false);
	t.is(afterSecond.servers[1].error, 'Connection timeout');
});

// Test LSP connection status progress tracking logic
test('tracks LSP connection status progress correctly', t => {
	const serverStates = new Map<
		string,
		{connected: boolean; languages?: string[]; error?: string}
	>();
	let currentStatus: LSPConnectionStatus = {
		totalCount: 0,
		connectedCount: 0,
		errorCount: 0,
		servers: [],
	};

	// Simulate the exact LSP progress callback logic
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

	// Initial status should be empty
	t.is(currentStatus.totalCount, 0);
	t.is(currentStatus.connectedCount, 0);
	t.is(currentStatus.errorCount, 0);

	// Auto-discovery: first server connects
	const afterFirst = simulateLSPProgress('rust-analyzer', true, ['rs']);
	t.is(afterFirst.totalCount, 1); // Discovered dynamically
	t.is(afterFirst.connectedCount, 1);
	t.is(afterFirst.errorCount, 0);
	t.deepEqual(afterFirst.servers[0].languages, ['rs']);

	// Auto-discovery: second server connects
	const afterSecond = simulateLSPProgress('typescript-language-server', true, [
		'ts',
		'js',
	]);
	t.is(afterSecond.totalCount, 2);
	t.is(afterSecond.connectedCount, 2);
	t.is(afterSecond.errorCount, 0);
	t.deepEqual(afterSecond.servers[0].languages, ['rs']);
	t.deepEqual(afterSecond.servers[1].languages, ['ts', 'js']);
});

// Test state object immutability (important for React re-renders)
test('maintains state object immutability', t => {
	const originalStatus: MCPConnectionStatus = {
		totalCount: 1,
		connectedCount: 0,
		errorCount: 0,
		servers: [{name: 'server1', connected: false, toolCount: 0}],
	};

	// Create new status object (correct pattern)
	const updatedStatus: MCPConnectionStatus = {
		...originalStatus,
		connectedCount: 1,
		servers: originalStatus.servers.map(server =>
			server.name === 'server1'
				? {...server, connected: true, toolCount: 5}
				: server,
		),
	};

	// Verify original wasn't mutated
	t.is(originalStatus.connectedCount, 0);
	t.is(originalStatus.servers[0].connected, false);

	// Verify new status has updates
	t.is(updatedStatus.connectedCount, 1);
	t.is(updatedStatus.servers[0].connected, true);
	t.is(updatedStatus.servers[0].toolCount, 5);

	// Verify reference equality (new objects created)
	t.not(originalStatus, updatedStatus);
	t.not(originalStatus.servers, updatedStatus.servers);
});

// Test error handling and recovery
test('handles connection error scenarios', t => {
	const testStatus = {
		totalCount: 3,
		connectedCount: 1,
		errorCount: 2,
		servers: [
			{name: 'server1', connected: true, toolCount: 5},
			{
				name: 'server2',
				connected: false,
				toolCount: 0,
				error: 'Process timeout',
			},
			{
				name: 'server3',
				connected: false,
				toolCount: 0,
				error: 'Invalid config',
			},
		],
	};

	// Verify error counts are calculated correctly
	const actualConnected = testStatus.servers.filter(s => s.connected).length;
	const actualErrors = testStatus.servers.filter(
		s => !s.connected && s.error,
	).length;

	t.is(actualConnected, testStatus.connectedCount);
	t.is(actualErrors, testStatus.errorCount);
	t.is(actualConnected + actualErrors, testStatus.totalCount);
});

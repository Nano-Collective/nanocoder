import test from 'ava';
import * as vscode from 'vscode';
import { AcpProcessManager } from './acp-process-manager';
import { AcpStateManager, ACPStatus } from './acp-state';
import { NanocoderAcpClient } from './acp-client';

test('AcpProcessManager - restart logic and retry backoff', (t) => {
	const outputChannel = { appendLine: () => {} } as any;
	const stateManager = new AcpStateManager();
	const acpClient = { 
		connection: null,
		rebindClient: () => {},
		initializeHandshake: async () => true,
		dispose: () => {}
	} as any as NanocoderAcpClient;

	const manager = new AcpProcessManager(outputChannel, stateManager, acpClient);

	// Mock start to just simulate starting
	let startCalls = 0;
	manager.start = async () => {
		startCalls++;
	};

	// Manually trigger restart
	(manager as any).handleCrash();

	// First retry attempt should happen immediately (delay = 0)
	// We can't strictly assert the setTimeout without a timer mock, but we can verify retryCount increments
	t.is((manager as any).retryCount, 1, 'retryCount should be incremented to 1');
	t.is(stateManager.status, ACPStatus.Restarting, 'status should be Restarting');
});

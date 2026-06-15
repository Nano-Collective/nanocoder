import test from 'ava';
import React from 'react';
import {runStreamingBashTool} from './streaming-bash-tool';

test('runStreamingBashTool propagates AbortSignal to underlying bash execution', async t => {
	const controller = new AbortController();
	
	const toolCall = {
		id: 'call_123',
		type: 'function',
		function: {
			name: 'execute_bash',
			arguments: '{"command":"sleep 10"}'
		}
	} as any;

	const setLiveComponent = () => {};

	// Abort immediately
	controller.abort();
	
	const start = Date.now();
	const result = await runStreamingBashTool(
		toolCall, 
		null, 
		setLiveComponent, 
		'test', 
		controller.signal
	);
	const elapsed = Date.now() - start;

	t.true(elapsed < 1000, 'Command should abort immediately instead of sleeping');
	t.truthy(result.bashState);
	t.is(result.bashState!.error, 'Cancelled via AbortSignal');
});

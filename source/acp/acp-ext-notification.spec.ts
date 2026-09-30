import test from 'ava';
import {
	AgentSideConnection,
	ClientSideConnection,
	ndJsonStream,
} from '@agentclientprotocol/sdk';

console.log('\nacp-ext-notification.spec.ts');

/**
 * The agent announces a generated session title with conn.notify(); the VS Code
 * client is expected to receive it as extNotification(method, params).
 *
 * Every other test in this repo stubs the connection, so that dispatch has
 * never actually crossed a wire. If the SDK routed it differently, the sidebar
 * would silently never refresh while all the unit tests stayed green.
 */
test('a title notification sent with notify() arrives as extNotification', async t => {
	const a2b = new TransformStream<Uint8Array, Uint8Array>();
	const b2a = new TransformStream<Uint8Array, Uint8Array>();

	const received: Array<{method: string; params: unknown}> = [];
	let resolveReceived: () => void;
	const gotOne = new Promise<void>(r => {
		resolveReceived = r;
	});

	// Client side, mirroring how acp-process-manager builds its handler object.
	new ClientSideConnection(
		() =>
			({
				sessionUpdate: async () => {},
				requestPermission: async () => ({outcome: {outcome: 'cancelled'}}),
				extNotification: async (method: string, params: unknown) => {
					received.push({method, params});
					resolveReceived();
				},
			}) as never,
		ndJsonStream(b2a.writable, a2b.readable),
	);

	// Agent side.
	const agentConn = new AgentSideConnection(
		() => ({}) as never,
		ndJsonStream(a2b.writable, b2a.readable),
	);

	await agentConn.notify('_nanocoder/sessionTitleChanged', {
		sessionId: 'session-1',
		title: 'Fix Login Redirect',
	});

	// Close both directions and drop the deadline timer however this ends. The
	// test passes without it today, but a change that stopped the notification
	// from arriving would leave the AVA worker holding open streams.
	let deadline: ReturnType<typeof setTimeout> | undefined;
	t.teardown(async () => {
		if (deadline) clearTimeout(deadline);
		await Promise.allSettled([
			a2b.writable.close(),
			b2a.writable.close(),
		]);
	});

	await Promise.race([
		gotOne,
		new Promise((_r, reject) => {
			deadline = setTimeout(
				() => reject(new Error('notification never arrived')),
				3000,
			);
		}),
	]);

	t.is(received.length, 1);
	t.is(received[0].method, '_nanocoder/sessionTitleChanged');
	t.deepEqual(received[0].params, {
		sessionId: 'session-1',
		title: 'Fix Login Redirect',
	});
});

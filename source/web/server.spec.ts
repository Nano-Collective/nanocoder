import test from 'ava';
import {WebSocket} from 'ws';
import {
	WEB_PROTOCOL_VERSION,
	type WebClientEvent,
	type WebServerEvent,
} from './protocol.js';
import {startLocalWebServer} from './server.js';

async function readText(url: string): Promise<{status: number; body: string}> {
	const response = await fetch(url);
	return {
		status: response.status,
		body: await response.text(),
	};
}

async function waitForWebSocketOpen(client: WebSocket): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		client.once('open', resolve);
		client.once('error', reject);
	});
}

async function readWebSocketEvent(client: WebSocket): Promise<WebServerEvent> {
	const message = await new Promise<string>(resolve => {
		client.once('message', data => {
			resolve(data.toString());
		});
	});
	return JSON.parse(message) as WebServerEvent;
}

function closeWebSocket(client: WebSocket): void {
	if (
		client.readyState === WebSocket.OPEN ||
		client.readyState === WebSocket.CLOSING
	) {
		client.close();
	}
}

test('local web server binds to localhost and serves token-protected browser chat page', async t => {
	const webServer = await startLocalWebServer({
		openBrowser: false,
		token: 'test-token',
	});
	t.teardown(() => {
		return webServer.close();
	});

	t.is(webServer.host, '127.0.0.1');
	t.is(webServer.token, 'test-token');
	t.true(webServer.url.startsWith(`http://127.0.0.1:${webServer.port}/`));
	t.true(webServer.url.endsWith('?token=test-token'));

	const response = await readText(webServer.url);
	t.is(response.status, 200);
	t.true(response.body.includes('Nanocoder web mode'));
	t.true(response.body.includes('id="messageForm"'));
	t.true(response.body.includes('id="messageInput"'));
	t.true(response.body.includes('id="newChatButton"'));
	t.true(response.body.includes('id="threadSearchInput"'));
	t.true(response.body.includes('window.localStorage'));
	t.true(response.body.includes('/assets/nanocoder-icon.svg'));
	t.true(response.body.includes("type: 'user_message'"));
	t.true(response.body.includes('submitUserMessage(prompt)'));
	t.true(response.body.includes('pointer-events: none;'));
});

test('local web server serves Nanocoder icon asset', async t => {
	const webServer = await startLocalWebServer({openBrowser: false});
	t.teardown(() => {
		return webServer.close();
	});

	const response = await fetch(
		`http://127.0.0.1:${webServer.port}/assets/nanocoder-icon.svg`,
	);
	const body = await response.text();

	t.is(response.status, 200);
	t.is(response.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
	t.true(body.includes('aria-label="Nanocoder"'));
});

test('local web server rejects placeholder page without valid token', async t => {
	const webServer = await startLocalWebServer({
		openBrowser: false,
		token: 'test-token',
	});
	t.teardown(() => {
		return webServer.close();
	});

	const response = await readText(`http://127.0.0.1:${webServer.port}/`);

	t.is(response.status, 401);
	t.is(response.body, 'Access token required');
});

test('local web server exposes health endpoint without token', async t => {
	const webServer = await startLocalWebServer({openBrowser: false});
	t.teardown(() => {
		return webServer.close();
	});

	const response = await fetch(`http://127.0.0.1:${webServer.port}/health`);
	const body = (await response.json()) as {ok: boolean; mode: string};

	t.is(response.status, 200);
	t.deepEqual(body, {ok: true, mode: 'web'});
});

test('local web server accepts token-protected WebSocket connections', async t => {
	const webServer = await startLocalWebServer({
		openBrowser: false,
		token: 'test-token',
	});
	t.teardown(() => {
		return webServer.close();
	});

	const client = new WebSocket(webServer.eventsUrl);
	t.teardown(() => {
		closeWebSocket(client);
	});
	const readyEvent = readWebSocketEvent(client);
	await waitForWebSocketOpen(client);

	const event = await readyEvent;

	t.deepEqual(event, {
		type: 'ready',
		protocolVersion: WEB_PROTOCOL_VERSION,
	});
});

test('local web server rejects WebSocket connections without a valid token', async t => {
	const webServer = await startLocalWebServer({
		openBrowser: false,
		token: 'test-token',
	});
	t.teardown(() => {
		return webServer.close();
	});

	const client = new WebSocket(
		`ws://127.0.0.1:${webServer.port}/events?token=wrong-token`,
	);
	t.teardown(() => {
		closeWebSocket(client);
	});

	const statusCode = await new Promise<number | undefined>(resolve => {
		client.once('unexpected-response', (_request, response) => {
			resolve(response.statusCode);
		});
		client.once('open', () => {
			resolve(undefined);
		});
	});

	t.is(statusCode, 401);
});

test('local web server acknowledges valid WebSocket client events', async t => {
	const webServer = await startLocalWebServer({
		openBrowser: false,
		token: 'test-token',
	});
	t.teardown(() => {
		return webServer.close();
	});

	const client = new WebSocket(webServer.eventsUrl);
	t.teardown(() => {
		closeWebSocket(client);
	});
	const readyEvent = readWebSocketEvent(client);
	await waitForWebSocketOpen(client);
	await readyEvent;

	client.send(
		JSON.stringify({
			type: 'user_message',
			id: 'message-1',
			text: 'hello',
		}),
	);
	const event = await readWebSocketEvent(client);

	t.deepEqual(event, {
		type: 'ack',
		id: 'message-1',
	});
});

test('local web server forwards valid browser events to the client event handler', async t => {
	let resolveClientEvent: (event: WebClientEvent) => void;
	const clientEvent = new Promise<WebClientEvent>(resolve => {
		resolveClientEvent = resolve;
	});
	const webServer = await startLocalWebServer({
		openBrowser: false,
		token: 'test-token',
		onClientEvent: event => {
			resolveClientEvent(event);
		},
	});
	t.teardown(() => {
		return webServer.close();
	});

	const client = new WebSocket(webServer.eventsUrl);
	t.teardown(() => {
		closeWebSocket(client);
	});
	const readyEvent = readWebSocketEvent(client);
	await waitForWebSocketOpen(client);
	await readyEvent;

	client.send(
		JSON.stringify({
			type: 'user_message',
			id: 'message-1',
			text: 'hello from browser',
		}),
	);
	const [receivedEvent, acknowledgementEvent] = await Promise.all([
		clientEvent,
		readWebSocketEvent(client),
	]);

	t.deepEqual(receivedEvent, {
		type: 'user_message',
		id: 'message-1',
		text: 'hello from browser',
	});
	t.deepEqual(acknowledgementEvent, {
		type: 'ack',
		id: 'message-1',
	});
});

test('local web server reports client event handler failures without acknowledging the message', async t => {
	const webServer = await startLocalWebServer({
		openBrowser: false,
		token: 'test-token',
		onClientEvent: () => {
			throw new Error('Browser event handler failed.');
		},
	});
	t.teardown(() => {
		return webServer.close();
	});

	const client = new WebSocket(webServer.eventsUrl);
	t.teardown(() => {
		closeWebSocket(client);
	});
	const readyEvent = readWebSocketEvent(client);
	await waitForWebSocketOpen(client);
	await readyEvent;

	client.send(
		JSON.stringify({
			type: 'user_message',
			id: 'message-1',
			text: 'hello',
		}),
	);
	const event = await readWebSocketEvent(client);

	t.deepEqual(event, {
		type: 'error',
		message: 'Browser event handler failed.',
	});
});

test('local web server reports invalid WebSocket messages without crashing', async t => {
	const webServer = await startLocalWebServer({
		openBrowser: false,
		token: 'test-token',
	});
	t.teardown(() => {
		return webServer.close();
	});

	const client = new WebSocket(webServer.eventsUrl);
	t.teardown(() => {
		closeWebSocket(client);
	});
	const readyEvent = readWebSocketEvent(client);
	await waitForWebSocketOpen(client);
	await readyEvent;

	client.send('{');
	const event = await readWebSocketEvent(client);

	t.deepEqual(event, {
		type: 'error',
		message: 'Invalid JSON message.',
	});
});

test('local web server can broadcast events to connected clients', async t => {
	const webServer = await startLocalWebServer({
		openBrowser: false,
		token: 'test-token',
	});
	t.teardown(() => {
		return webServer.close();
	});

	const client = new WebSocket(webServer.eventsUrl);
	t.teardown(() => {
		closeWebSocket(client);
	});
	const readyEvent = readWebSocketEvent(client);
	await waitForWebSocketOpen(client);
	await readyEvent;

	webServer.broadcastEvent({
		type: 'turn_completed',
		id: 'turn-1',
	});
	const event = await readWebSocketEvent(client);

	t.deepEqual(event, {
		type: 'turn_completed',
		id: 'turn-1',
	});
});

test('local web server closes WebSocket clients during shutdown', async t => {
	const webServer = await startLocalWebServer({
		openBrowser: false,
		token: 'test-token',
	});
	const client = new WebSocket(webServer.eventsUrl);
	const readyEvent = readWebSocketEvent(client);
	await waitForWebSocketOpen(client);
	await readyEvent;

	const closePromise = new Promise<void>(resolve => {
		client.once('close', () => {
			resolve();
		});
	});

	await webServer.close();
	await closePromise;

	t.is(client.readyState, WebSocket.CLOSED);
});

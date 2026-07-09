import test from 'ava';
import {startLocalWebServer} from './server.js';

async function readText(url: string): Promise<{status: number; body: string}> {
	const response = await fetch(url);
	return {
		status: response.status,
		body: await response.text(),
	};
}

test('local web server binds to localhost and serves token-protected placeholder page', async t => {
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

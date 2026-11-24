import http from 'node:http';
import type {AddressInfo, Socket} from 'node:net';
import test from 'ava';

// Kept in its own file: honouring a proxy installs a process-wide dispatcher
// for global fetch, which other specs must not inherit.
test.serial('executeWebSearch sends its request through HTTPS_PROXY', async t => {
	const connectTargets: string[] = [];
	const proxy = http.createServer();
	proxy.on('connect', (req, socket: Socket) => {
		connectTargets.push(req.url ?? '');
		socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
	});
	await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
	const port = (proxy.address() as AddressInfo).port;

	// undici prefers the lowercase names, so clear every spelling.
	const keys = [
		'HTTP_PROXY',
		'http_proxy',
		'HTTPS_PROXY',
		'https_proxy',
		'NO_PROXY',
		'no_proxy',
	];
	const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
	for (const key of keys) {
		delete process.env[key];
	}
	process.env.HTTPS_PROXY = `http://127.0.0.1:${port}`;

	try {
		const {executeWebSearch} = await import('./web-search.js');
		await t.throwsAsync(executeWebSearch({query: 'proxy test'}, 'test-key'));
		t.deepEqual(connectTargets, ['api.search.brave.com:443']);
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
		proxy.close();
		proxy.closeAllConnections?.();
	}
});

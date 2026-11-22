import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type {AddressInfo, Socket} from 'node:net';
import net from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {Agent, EnvHttpProxyAgent, request} from 'undici';
import {createDispatcher, hasProxyEnv} from './proxy-dispatcher.js';

const PROXY_KEYS = [
	'HTTP_PROXY',
	'http_proxy',
	'HTTPS_PROXY',
	'https_proxy',
	'NO_PROXY',
	'no_proxy',
] as const;

const saved: Record<string, string | undefined> = {};

test.beforeEach(() => {
	for (const key of PROXY_KEYS) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
});

test.afterEach.always(() => {
	for (const key of PROXY_KEYS) {
		if (saved[key] === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = saved[key];
		}
	}
});

const listen = (server: net.Server): Promise<number> =>
	new Promise(resolve => {
		server.listen(0, '127.0.0.1', () =>
			resolve((server.address() as AddressInfo).port),
		);
	});

const close = (server: net.Server): Promise<void> =>
	new Promise(resolve => {
		server.close(() => resolve());
		server.closeAllConnections?.();
	});

// ----------------------------------------------------------------------------
// Selection
// ----------------------------------------------------------------------------

test('hasProxyEnv is false with no proxy variables', t => {
	t.false(hasProxyEnv({}));
});

test('hasProxyEnv is false for NO_PROXY alone and for blank values', t => {
	t.false(hasProxyEnv({NO_PROXY: 'localhost'}));
	t.false(hasProxyEnv({HTTPS_PROXY: '  '}));
});

test('hasProxyEnv accepts upper and lower case variables', t => {
	t.true(hasProxyEnv({HTTP_PROXY: 'http://p:1'}));
	t.true(hasProxyEnv({http_proxy: 'http://p:1'}));
	t.true(hasProxyEnv({HTTPS_PROXY: 'http://p:1'}));
	t.true(hasProxyEnv({https_proxy: 'http://p:1'}));
});

test('createDispatcher returns a plain Agent with no proxy variables', t => {
	const dispatcher = createDispatcher({}, {});
	t.true(dispatcher instanceof Agent);
	t.false(dispatcher instanceof EnvHttpProxyAgent);
});

test('createDispatcher returns an EnvHttpProxyAgent when HTTPS_PROXY is set', t => {
	const dispatcher = createDispatcher({}, {HTTPS_PROXY: 'http://127.0.0.1:1'});
	t.true(dispatcher instanceof EnvHttpProxyAgent);
});

test('createDispatcher returns an EnvHttpProxyAgent for lowercase http_proxy', t => {
	const dispatcher = createDispatcher({}, {http_proxy: 'http://127.0.0.1:1'});
	t.true(dispatcher instanceof EnvHttpProxyAgent);
});

test('createDispatcher keeps a plain Agent when only NO_PROXY is set', t => {
	const dispatcher = createDispatcher({}, {NO_PROXY: 'localhost'});
	t.false(dispatcher instanceof EnvHttpProxyAgent);
});

// ----------------------------------------------------------------------------
// Behaviour against real local servers
// ----------------------------------------------------------------------------

test.serial(
	'proxied requests go through the proxy and NO_PROXY hosts bypass it',
	async t => {
		const origin = http.createServer((_req, res) => res.end('origin'));
		const seenByProxy: string[] = [];
		const proxy = http.createServer((req, res) => {
			seenByProxy.push(req.url ?? '');
			res.end('proxy');
		});
		const originPort = await listen(origin);
		const proxyPort = await listen(proxy);

		try {
			process.env.HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;

			const viaProxy = createDispatcher();
			const proxied = await request(`http://127.0.0.1:${originPort}/a`, {
				dispatcher: viaProxy,
			});
			t.is(await proxied.body.text(), 'proxy');
			t.deepEqual(seenByProxy, [`http://127.0.0.1:${originPort}/a`]);

			process.env.NO_PROXY = '127.0.0.1';
			const bypass = createDispatcher();
			const direct = await request(`http://127.0.0.1:${originPort}/b`, {
				dispatcher: bypass,
			});
			t.is(await direct.body.text(), 'origin');
			t.is(seenByProxy.length, 1);

			await Promise.all([viaProxy.close(), bypass.close()]);
		} finally {
			await Promise.all([close(origin), close(proxy)]);
		}
	},
);

test.serial(
	'connect TLS options still apply to the target when tunnelling through a proxy',
	async t => {
		const dir = mkdtempSync(join(tmpdir(), 'nanocoder-proxy-tls-'));
		try {
			try {
				execFileSync(
					'openssl',
					[
						'req',
						'-x509',
						'-newkey',
						'rsa:2048',
						'-nodes',
						'-keyout',
						join(dir, 'key.pem'),
						'-out',
						join(dir, 'cert.pem'),
						'-days',
						'1',
						'-subj',
						'/CN=localhost',
						'-addext',
						'subjectAltName=DNS:localhost,IP:127.0.0.1',
					],
					{stdio: 'ignore'},
				);
			} catch {
				t.pass('openssl unavailable, skipping');
				return;
			}
			const cert = readFileSync(join(dir, 'cert.pem'), 'utf8');
			const key = readFileSync(join(dir, 'key.pem'), 'utf8');

			const origin = https.createServer({cert, key}, (_req, res) =>
				res.end('secure-origin'),
			);
			const originPort = await listen(origin);

			let connectTargets = 0;
			const proxy = http.createServer();
			proxy.on('connect', (req, clientSocket: Socket, head) => {
				connectTargets++;
				const [host, port] = (req.url ?? '').split(':');
				const upstream = net.connect(Number(port), host, () => {
					clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
					upstream.write(head);
					upstream.pipe(clientSocket);
					clientSocket.pipe(upstream);
				});
				upstream.on('error', () => clientSocket.destroy());
				clientSocket.on('error', () => upstream.destroy());
			});
			const proxyPort = await listen(proxy);

			try {
				process.env.HTTPS_PROXY = `http://127.0.0.1:${proxyPort}`;
				const url = `https://localhost:${originPort}/`;

				const trusted = createDispatcher({connect: {timeout: 5000, ca: cert}});
				const ok = await request(url, {dispatcher: trusted});
				t.is(await ok.body.text(), 'secure-origin');
				t.is(connectTargets, 1);

				const untrusted = createDispatcher({connect: {timeout: 5000}});
				await t.throwsAsync(request(url, {dispatcher: untrusted}));

				await Promise.all([trusted.close(), untrusted.close()]);
			} finally {
				await Promise.all([close(origin), close(proxy)]);
			}
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	},
);

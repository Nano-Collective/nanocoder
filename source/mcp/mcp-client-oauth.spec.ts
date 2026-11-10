import test from 'ava';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type {AddressInfo} from 'node:net';
import {loadMCPOAuthCredential} from '../config/mcp-oauth-credentials.js';
import {MCPClient} from './mcp-client.js';
import {MCPAuthRequiredError} from './oauth-provider.js';

console.log(`\nmcp-client-oauth.spec.ts`);

/**
 * A tiny OAuth-protected Streamable HTTP MCP server: without a Bearer token it
 * answers 401 with a resource-metadata challenge, serves authorization server
 * metadata and dynamic client registration, issues tokens on /token, and once
 * a valid token is presented it answers the MCP initialize / tools/list
 * requests with plain JSON responses.
 */
interface MockServer {
	origin: string;
	mcpUrl: string;
	close: () => Promise<void>;
	registrations: number;
	tokenRequests: Array<Record<string, string>>;
	authorizedCalls: number;
}

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise(resolve => {
		let body = '';
		req.setEncoding('utf8');
		req.on('data', chunk => {
			body += chunk;
		});
		req.on('end', () => resolve(body));
	});
}

function json(res: http.ServerResponse, status: number, value: unknown): void {
	res.writeHead(status, {'Content-Type': 'application/json'});
	res.end(JSON.stringify(value));
}

async function startMockServer(): Promise<MockServer> {
	const state: MockServer = {
		origin: '',
		mcpUrl: '',
		close: async () => {},
		registrations: 0,
		tokenRequests: [],
		authorizedCalls: 0,
	};
	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', state.origin);
		if (url.pathname === '/.well-known/oauth-protected-resource') {
			return json(res, 200, {
				resource: state.mcpUrl,
				authorization_servers: [state.origin],
			});
		}
		if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) {
			return json(res, 200, {
				issuer: state.origin,
				authorization_endpoint: `${state.origin}/authorize`,
				token_endpoint: `${state.origin}/token`,
				registration_endpoint: `${state.origin}/register`,
				response_types_supported: ['code'],
				grant_types_supported: ['authorization_code', 'refresh_token'],
				code_challenge_methods_supported: ['S256'],
				token_endpoint_auth_methods_supported: ['none'],
			});
		}
		if (url.pathname.startsWith('/.well-known/')) {
			return json(res, 404, {error: 'not found'});
		}
		if (url.pathname === '/register' && req.method === 'POST') {
			state.registrations++;
			const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
			return json(res, 201, {
				client_id: 'mock-client',
				redirect_uris: body.redirect_uris,
				token_endpoint_auth_method: 'none',
			});
		}
		if (url.pathname === '/token' && req.method === 'POST') {
			const params = Object.fromEntries(
				new URLSearchParams(await readBody(req)).entries(),
			);
			state.tokenRequests.push(params);
			if (params.grant_type === 'authorization_code' && params.code === 'good-code') {
				return json(res, 200, {
					access_token: 'access-1',
					token_type: 'Bearer',
					expires_in: 3600,
					refresh_token: 'refresh-1',
				});
			}
			return json(res, 400, {error: 'invalid_grant'});
		}
		if (url.pathname === '/mcp') {
			const authorization = req.headers.authorization;
			if (authorization !== 'Bearer access-1') {
				res.writeHead(401, {
					'WWW-Authenticate': `Bearer resource_metadata="${state.origin}/.well-known/oauth-protected-resource"`,
					'Content-Type': 'text/plain',
				});
				res.end('unauthorized');
				return;
			}
			state.authorizedCalls++;
			if (req.method === 'DELETE') {
				res.writeHead(200);
				res.end();
				return;
			}
			if (req.method !== 'POST') {
				// No server-initiated SSE stream in this mock.
				res.writeHead(405);
				res.end();
				return;
			}
			const body = await readBody(req);
			const message = JSON.parse(body) as {
				id?: number | string;
				method?: string;
			};
			if (message.id === undefined) {
				res.writeHead(202);
				res.end();
				return;
			}
			if (message.method === 'initialize') {
				return json(res, 200, {
					jsonrpc: '2.0',
					id: message.id,
					result: {
						protocolVersion: '2025-03-26',
						capabilities: {tools: {}},
						serverInfo: {name: 'mock-oauth-server', version: '1.0.0'},
					},
				});
			}
			if (message.method === 'tools/list') {
				return json(res, 200, {
					jsonrpc: '2.0',
					id: message.id,
					result: {
						tools: [
							{
								name: 'whoami',
								description: 'Who am I',
								inputSchema: {type: 'object', properties: {}},
							},
						],
					},
				});
			}
			if (message.method === 'ping') {
				return json(res, 200, {jsonrpc: '2.0', id: message.id, result: {}});
			}
			return json(res, 200, {
				jsonrpc: '2.0',
				id: message.id,
				error: {code: -32601, message: 'Method not found'},
			});
		}
		json(res, 404, {error: 'not found'});
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const {port} = server.address() as AddressInfo;
	state.origin = `http://127.0.0.1:${port}`;
	state.mcpUrl = `${state.origin}/mcp`;
	state.close = () =>
		new Promise(resolve => {
			server.closeAllConnections?.();
			server.close(() => resolve());
		});
	return state;
}

let testConfigDir: string;
let originalConfigDir: string | undefined;

test.before(() => {
	testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocoder-mcp-client-oauth-'));
	originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = testConfigDir;
});

test.after.always(() => {
	if (testConfigDir && fs.existsSync(testConfigDir)) {
		fs.rmSync(testConfigDir, {recursive: true, force: true});
	}
	if (originalConfigDir !== undefined) {
		process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
	} else {
		delete process.env.NANOCODER_CONFIG_DIR;
	}
});

test.serial('connect to an OAuth-protected server reports auth required instead of failing', async t => {
	const mock = await startMockServer();
	const client = new MCPClient();
	try {
		const results = await client.connectToServers([
			{name: 'remote', transport: 'http', url: mock.mcpUrl, healthCheckInterval: 0},
		]);
		t.is(results.length, 1);
		t.false(results[0].success);
		t.regex(results[0].error ?? '', /Authentication required for MCP server "remote"/);
		t.regex(results[0].error ?? '', /\/mcp login remote/);
		t.deepEqual(client.getAuthRequiredServers(), ['remote']);
		t.deepEqual(client.getServerNames(), []);
		// Discovery + dynamic registration ran and the registration was persisted
		// so the later interactive login does not register a second client.
		t.is(mock.registrations, 1);
		t.is(loadMCPOAuthCredential(mock.mcpUrl)?.clientInformation?.client_id, 'mock-client');
		t.is(loadMCPOAuthCredential(mock.mcpUrl)?.tokens, undefined);

		await t.throwsAsync(() => client.connectToServer({name: 'remote', transport: 'http', url: mock.mcpUrl}), {
			instanceOf: MCPAuthRequiredError,
		});
	} finally {
		await client.disconnect();
		await mock.close();
	}
});

test.serial('login completes the browser flow, stores tokens and connects', async t => {
	const mock = await startMockServer();
	const client = new MCPClient();
	const healthChanges: string[] = [];
	client.onHealthChange(change => healthChanges.push(`${change.serverName}:${change.status}`));
	try {
		await client.connectToServers([
			{name: 'remote', transport: 'http', url: mock.mcpUrl, healthCheckInterval: 0},
		]);
		t.deepEqual(client.getAuthRequiredServers(), ['remote']);

		let authorizationUrl: URL | undefined;
		const login = client.loginToServer('remote', {
			openBrowser: false,
			onAuthorizationUrl: url => {
				authorizationUrl = url;
				// Simulate the user finishing the sign-in: the authorization server
				// redirects the browser back to the loopback URL with code+state.
				const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
				redirect.searchParams.set('code', 'good-code');
				redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
				http.get(redirect, res => res.resume()).on('error', () => {});
			},
		});
		await login;

		t.truthy(authorizationUrl);
		t.is(authorizationUrl?.origin, mock.origin);
		t.is(authorizationUrl?.pathname, '/authorize');
		t.is(authorizationUrl?.searchParams.get('client_id'), 'mock-client');
		t.is(authorizationUrl?.searchParams.get('code_challenge_method'), 'S256');
		t.regex(authorizationUrl?.searchParams.get('redirect_uri') ?? '', /^http:\/\/127\.0\.0\.1:\d+\/callback$/);

		// Token exchange used PKCE and the registered public client.
		const exchange = mock.tokenRequests.find(r => r.grant_type === 'authorization_code');
		t.truthy(exchange?.code_verifier);
		t.is(exchange?.client_id, 'mock-client');
		t.is(mock.registrations, 1);

		// Tokens persisted owner-only; server connected and its tools listed.
		const stored = loadMCPOAuthCredential(mock.mcpUrl);
		t.is(stored?.tokens?.access_token, 'access-1');
		t.is(stored?.tokens?.refresh_token, 'refresh-1');
		if (process.platform !== 'win32') {
			t.is(fs.statSync(path.join(testConfigDir, 'mcp-oauth-credentials.json')).mode & 0o777, 0o600);
		}
		t.deepEqual(client.getAuthRequiredServers(), []);
		t.deepEqual(client.getServerNames(), ['remote']);
		t.true(client.isServerConnected('remote'));
		t.deepEqual(client.getServerTools('remote').map(tool => tool.name), ['whoami']);
		t.true(mock.authorizedCalls >= 2);

		// A fresh client reuses the stored token without any login.
		const second = new MCPClient();
		try {
			const results = await second.connectToServers([
				{name: 'remote', transport: 'http', url: mock.mcpUrl, healthCheckInterval: 0},
			]);
			t.true(results[0].success);
			t.is(results[0].toolCount, 1);
		} finally {
			await second.disconnect();
		}

		// Logout drops the tokens, disconnects and flags the server again.
		await client.logoutFromServer('remote');
		t.is(loadMCPOAuthCredential(mock.mcpUrl), null);
		t.deepEqual(client.getServerNames(), []);
		t.deepEqual(client.getAuthRequiredServers(), ['remote']);
		t.true(healthChanges.includes('remote:unhealthy'));
	} finally {
		await client.disconnect();
		await mock.close();
	}
});

test.serial('login and logout validate the server', async t => {
	const client = new MCPClient();
	await t.throwsAsync(() => client.loginToServer('missing'), {message: /Unknown MCP server "missing"/});
	await t.throwsAsync(() => client.logoutFromServer('missing'), {message: /Unknown MCP server "missing"/});
	await client.disconnect();
});

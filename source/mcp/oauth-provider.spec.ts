import test from 'ava';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import {UnauthorizedError} from '@modelcontextprotocol/sdk/client/auth.js';
import {loadMCPOAuthCredential} from '../config/mcp-oauth-credentials.js';
import {
	browserOpenCommand,
	MCPAuthRequiredError,
	MCPOAuthProvider,
	isAuthRequiredError,
} from './oauth-provider.js';

console.log(`\noauth-provider.spec.ts`);

let testConfigDir: string;
let originalConfigDir: string | undefined;

test.before(() => {
	testConfigDir = fs.mkdtempSync(
		path.join(os.tmpdir(), 'nanocoder-mcp-oauth-provider-'),
	);
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

function get(url: URL): Promise<{status: number; body: string}> {
	return new Promise((resolve, reject) => {
		http
			.get(url, res => {
				let body = '';
				res.setEncoding('utf8');
				res.on('data', chunk => {
					body += chunk;
				});
				res.on('end', () =>
					resolve({status: res.statusCode ?? 0, body}),
				);
			})
			.on('error', reject);
	});
}

test.serial('persists tokens and client information per server URL', t => {
	const provider = new MCPOAuthProvider({
		serverName: 'remote',
		serverUrl: 'https://one.example.com/mcp',
	});
	t.is(provider.tokens(), undefined);
	t.is(provider.clientInformation(), undefined);

	provider.saveClientInformation({client_id: 'cid'});
	provider.saveTokens({access_token: 'at', token_type: 'Bearer'});

	t.is(provider.clientInformation()?.client_id, 'cid');
	t.is(provider.tokens()?.access_token, 'at');
	t.truthy(loadMCPOAuthCredential('https://one.example.com/mcp')?.tokensSavedAt);

	const other = new MCPOAuthProvider({
		serverName: 'other',
		serverUrl: 'https://two.example.com/mcp',
	});
	t.is(other.tokens(), undefined);

	provider.invalidateCredentials('tokens');
	t.is(provider.tokens(), undefined);
	t.is(provider.clientInformation()?.client_id, 'cid');
	provider.invalidateCredentials('all');
	t.is(provider.clientInformation(), undefined);
});

test.serial('client metadata is a public client using the loopback redirect', t => {
	const provider = new MCPOAuthProvider({
		serverName: 'remote',
		serverUrl: 'https://one.example.com/mcp',
	});
	const metadata = provider.clientMetadata;
	t.is(metadata.token_endpoint_auth_method, 'none');
	t.deepEqual(metadata.grant_types, ['authorization_code', 'refresh_token']);
	t.is(metadata.redirect_uris[0], 'http://127.0.0.1/callback');
	t.is(provider.state(), provider.state());
});

test.serial('non-interactive provider refuses to start a browser login', t => {
	const provider = new MCPOAuthProvider({
		serverName: 'remote',
		serverUrl: 'https://one.example.com/mcp',
	});
	const error = t.throws(
		() => provider.redirectToAuthorization(new URL('https://auth.example.com/authorize')),
		{instanceOf: MCPAuthRequiredError},
	);
	t.regex(error.message, /\/mcp login remote/);
});

test.serial('codeVerifier throws until saved', t => {
	const provider = new MCPOAuthProvider({
		serverName: 'remote',
		serverUrl: 'https://one.example.com/mcp',
	});
	t.throws(() => provider.codeVerifier());
	provider.saveCodeVerifier('verifier');
	t.is(provider.codeVerifier(), 'verifier');
	provider.invalidateCredentials('verifier');
	t.throws(() => provider.codeVerifier());
});

test.serial('interactive provider reports the URL and receives the loopback code', async t => {
	let reported: URL | undefined;
	const provider = new MCPOAuthProvider({
		serverName: 'remote',
		serverUrl: 'https://one.example.com/mcp',
		interactive: true,
		openBrowser: false,
		onAuthorizationUrl: url => {
			reported = url;
		},
	});

	const redirectUrl = await provider.startCallbackListener();
	t.is(redirectUrl.hostname, '127.0.0.1');
	t.is(redirectUrl.pathname, '/callback');
	t.not(redirectUrl.port, '');
	t.is(provider.redirectUrl?.toString(), redirectUrl.toString());
	t.is(provider.clientMetadata.redirect_uris[0], redirectUrl.toString());

	provider.redirectToAuthorization(new URL('https://auth.example.com/authorize?x=1'));
	t.is(reported?.toString(), 'https://auth.example.com/authorize?x=1');

	// A request with the wrong state is rejected and does not settle the wait.
	const bad = new URL(redirectUrl);
	bad.searchParams.set('code', 'evil');
	bad.searchParams.set('state', 'not-ours');
	const badResponse = await get(bad);
	t.is(badResponse.status, 400);
	t.regex(badResponse.body, /State parameter mismatch/);

	// Unknown paths are 404.
	const notFound = await get(new URL('/favicon.ico', redirectUrl));
	t.is(notFound.status, 404);

	// The real callback resolves the code and shows a success page.
	const good = new URL(redirectUrl);
	good.searchParams.set('code', 'the-code');
	good.searchParams.set('state', provider.state());
	const [code, goodResponse] = await Promise.all([
		provider.waitForAuthorizationCode(),
		get(good),
	]);
	t.is(code, 'the-code');
	t.is(goodResponse.status, 200);
	t.regex(goodResponse.body, /Signed in/);

	// Listener is torn down afterwards.
	await t.throwsAsync(() => provider.waitForAuthorizationCode(), {
		message: /not running/,
	});
});

test.serial('authorization server errors reject the wait', async t => {
	const provider = new MCPOAuthProvider({
		serverName: 'remote',
		serverUrl: 'https://one.example.com/mcp',
		interactive: true,
		openBrowser: false,
	});
	const redirectUrl = await provider.startCallbackListener();
	const denied = new URL(redirectUrl);
	denied.searchParams.set('error', 'access_denied');
	denied.searchParams.set('error_description', 'user said no');
	denied.searchParams.set('state', provider.state());
	const [response, error] = await Promise.all([
		get(denied),
		provider.waitForAuthorizationCode().catch((e: Error) => e),
	]);
	t.is(response.status, 400);
	t.true(error instanceof Error);
	t.regex((error as Error).message, /access_denied.*user said no/);
});

test.serial('callback wait times out', async t => {
	const provider = new MCPOAuthProvider({
		serverName: 'remote',
		serverUrl: 'https://one.example.com/mcp',
		interactive: true,
		openBrowser: false,
		callbackTimeoutMs: 20,
	});
	await provider.startCallbackListener();
	await t.throwsAsync(() => provider.waitForAuthorizationCode(), {
		message: /Timed out/,
	});
});

test('isAuthRequiredError recognizes SDK and local auth errors', t => {
	t.true(isAuthRequiredError(new MCPAuthRequiredError('x')));
	t.true(isAuthRequiredError(new UnauthorizedError('nope')));
	const foreign = new Error('x');
	foreign.name = 'UnauthorizedError';
	t.true(isAuthRequiredError(foreign));
	t.false(isAuthRequiredError(new Error('connection refused')));
	t.false(isAuthRequiredError('string'));
	t.false(isAuthRequiredError(null));
});

test('browserOpenCommand passes the full URL to the opener unmodified', t => {
	const href =
		'https://auth.example.com/authorize?response_type=code&client_id=c&state=s&code_challenge=x&redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcallback';
	t.deepEqual(browserOpenCommand(href, 'darwin'), {
		command: 'open',
		args: [href],
	});
	t.deepEqual(browserOpenCommand(href, 'linux'), {
		command: 'xdg-open',
		args: [href],
	});
	// Windows must not go through cmd.exe, which splits the command at `&`.
	const windows = browserOpenCommand(href, 'win32');
	t.is(windows?.command, 'rundll32');
	t.deepEqual(windows?.args, ['url.dll,FileProtocolHandler', href]);
	t.false(windows?.args.includes('/c'));
});

test('browserOpenCommand refuses non-http(s) URLs', t => {
	t.is(browserOpenCommand('file:///etc/passwd', 'linux'), undefined);
	t.is(browserOpenCommand('javascript:alert(1)', 'darwin'), undefined);
	t.is(browserOpenCommand('not a url', 'win32'), undefined);
});

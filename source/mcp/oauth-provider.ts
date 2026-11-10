/**
 * OAuth 2.1 client provider for remote (HTTP) MCP servers.
 *
 * Implements the MCP SDK's `OAuthClientProvider` so that the Streamable HTTP
 * transport can attach Bearer tokens, refresh them automatically, and, when a
 * server answers 401 with an OAuth challenge, run the standard authorization
 * code + PKCE flow:
 *
 *   1. discover the authorization server (handled by the SDK),
 *   2. register the client dynamically when needed (handled by the SDK),
 *   3. open the user's browser (or print the URL) to the authorization page,
 *   4. receive the code on a loopback redirect (127.0.0.1:<random port>),
 *   5. exchange it for tokens and persist them owner-only in the user config
 *      directory (see `@/config/mcp-oauth-credentials`).
 *
 * Two modes:
 *  - non-interactive (startup / reconnects): stored tokens are used and
 *    refreshed, but a required browser login is never started. Instead the
 *    provider throws `MCPAuthRequiredError` so the caller can tell the user to
 *    run `/mcp login <server>`.
 *  - interactive (`/mcp login`): a loopback listener is started and the
 *    browser is opened.
 */

import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import * as http from 'node:http';
import type {AddressInfo} from 'node:net';
import type {OAuthClientProvider} from '@modelcontextprotocol/sdk/client/auth.js';
import {UnauthorizedError} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
	OAuthClientInformationMixed,
	OAuthClientMetadata,
	OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import {
	loadMCPOAuthCredential,
	removeMCPOAuthCredential,
	saveMCPOAuthCredential,
} from '@/config/mcp-oauth-credentials';

/** Thrown when a server requires a browser login that cannot run right now. */
export class MCPAuthRequiredError extends Error {
	readonly serverName: string;

	constructor(serverName: string) {
		super(
			`Authentication required for MCP server "${serverName}". Run /mcp login ${serverName} to sign in.`,
		);
		this.name = 'MCPAuthRequiredError';
		this.serverName = serverName;
	}
}

/**
 * True when `error` means the server wants the user to authenticate: either
 * our own marker error or the SDK's UnauthorizedError (401 without a usable
 * token, or a refresh that was rejected).
 */
export function isAuthRequiredError(error: unknown): boolean {
	if (error instanceof MCPAuthRequiredError) {
		return true;
	}
	if (error instanceof UnauthorizedError) {
		return true;
	}
	// The SDK may wrap errors across module boundaries; fall back to the name.
	return (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		((error as {name?: unknown}).name === 'UnauthorizedError' ||
			(error as {name?: unknown}).name === 'MCPAuthRequiredError')
	);
}

export interface MCPOAuthProviderOptions {
	/** Config name of the server, for error messages. */
	serverName: string;
	/** Server URL, used as the credential store key. */
	serverUrl: string;
	/**
	 * When true the provider may start the loopback listener and open the
	 * browser. When false (default) a required login throws
	 * `MCPAuthRequiredError` instead.
	 */
	interactive?: boolean;
	/**
	 * Called with the authorization URL once the browser flow starts, so the UI
	 * can show it in case the browser could not be opened automatically.
	 */
	onAuthorizationUrl?: (url: URL) => void;
	/** Try to open the system browser (default true in interactive mode). */
	openBrowser?: boolean;
	/** How long to wait for the redirect, in ms (default 5 minutes). */
	callbackTimeoutMs?: number;
}

const DEFAULT_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const CALLBACK_PATH = '/callback';

const SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Nanocoder</title></head>
<body style="font-family: system-ui, sans-serif; margin: 3rem;">
<h1>Signed in</h1><p>Nanocoder received the authorization code. You can close this tab and return to your terminal.</p>
</body></html>`;

function errorHtml(message: string): string {
	const escaped = message
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
	return `<!doctype html><html><head><meta charset="utf-8"><title>Nanocoder</title></head>
<body style="font-family: system-ui, sans-serif; margin: 3rem;">
<h1>Sign-in failed</h1><p>${escaped}</p><p>Return to your terminal and try <code>/mcp login</code> again.</p>
</body></html>`;
}

/**
 * The command that opens `href` in the default browser on `platform`, or
 * undefined when the URL must not be handed to an opener at all.
 *
 * The authorization URL comes from server-supplied metadata, so it is
 * untrusted: only http(s) URLs are opened, and on Windows the URL never goes
 * through cmd.exe, whose parser treats `&` (present in every authorization
 * URL) as a command separator. `rundll32 url.dll,FileProtocolHandler` takes
 * the URL as a single argument and hands it to the default browser.
 */
export function browserOpenCommand(
	href: string,
	platform: NodeJS.Platform = process.platform,
): {command: string; args: string[]} | undefined {
	let protocol: string;
	try {
		protocol = new URL(href).protocol;
	} catch {
		return undefined;
	}
	if (protocol !== 'https:' && protocol !== 'http:') {
		return undefined;
	}
	if (platform === 'darwin') {
		return {command: 'open', args: [href]};
	}
	if (platform === 'win32') {
		return {command: 'rundll32', args: ['url.dll,FileProtocolHandler', href]};
	}
	return {command: 'xdg-open', args: [href]};
}

/**
 * Best-effort: open `url` in the default browser. Failures are swallowed; the
 * URL is always shown to the user as well.
 */
function openInBrowser(url: URL): void {
	const opener = browserOpenCommand(url.toString());
	if (!opener) {
		return;
	}
	try {
		const child = spawn(opener.command, opener.args, {
			detached: true,
			stdio: 'ignore',
		});
		child.on('error', () => {
			/* no browser available; the URL is printed for the user */
		});
		child.unref();
	} catch {
		/* ignore */
	}
}

interface PendingCallback {
	server: http.Server;
	redirectUrl: URL;
	code: Promise<string>;
}

export class MCPOAuthProvider implements OAuthClientProvider {
	private readonly serverName: string;
	private readonly serverUrl: string;
	private readonly interactive: boolean;
	private readonly onAuthorizationUrl?: (url: URL) => void;
	private readonly shouldOpenBrowser: boolean;
	private readonly callbackTimeoutMs: number;

	private currentState: string | undefined;
	private currentCodeVerifier: string | undefined;
	private pending: PendingCallback | undefined;
	/**
	 * The transport asks for tokens on every request; cache them so a tool
	 * call does not re-read the credentials file. `null` means "not loaded".
	 */
	private cachedTokens: OAuthTokens | undefined | null = null;

	constructor(options: MCPOAuthProviderOptions) {
		this.serverName = options.serverName;
		this.serverUrl = options.serverUrl;
		this.interactive = options.interactive ?? false;
		this.onAuthorizationUrl = options.onAuthorizationUrl;
		this.shouldOpenBrowser = options.openBrowser ?? true;
		this.callbackTimeoutMs =
			options.callbackTimeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS;
	}

	// ---------------------------------------------------------------------
	// OAuthClientProvider
	// ---------------------------------------------------------------------

	get redirectUrl(): URL | undefined {
		// Before the loopback listener exists we still need a redirect URI for
		// dynamic client registration. Register with the loopback origin
		// without a port: RFC 8252 §7.3 requires authorization servers to allow
		// any port for loopback redirect URIs, so the real port chosen later
		// still matches.
		return (
			this.pending?.redirectUrl ?? new URL(`http://127.0.0.1${CALLBACK_PATH}`)
		);
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: 'Nanocoder',
			client_uri: 'https://github.com/Nano-Collective/nanocoder',
			redirect_uris: [this.redirectUrl?.toString() ?? ''],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
		};
	}

	state(): string {
		if (!this.currentState) {
			this.currentState = randomBytes(24).toString('base64url');
		}
		return this.currentState;
	}

	clientInformation(): OAuthClientInformationMixed | undefined {
		return loadMCPOAuthCredential(this.serverUrl)?.clientInformation;
	}

	saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
		saveMCPOAuthCredential(this.serverUrl, {clientInformation});
	}

	tokens(): OAuthTokens | undefined {
		if (this.cachedTokens === null) {
			this.cachedTokens = loadMCPOAuthCredential(this.serverUrl)?.tokens;
		}
		return this.cachedTokens;
	}

	saveTokens(tokens: OAuthTokens): void {
		saveMCPOAuthCredential(this.serverUrl, {
			tokens,
			tokensSavedAt: Date.now(),
		});
		this.cachedTokens = tokens;
	}

	saveCodeVerifier(codeVerifier: string): void {
		this.currentCodeVerifier = codeVerifier;
	}

	codeVerifier(): string {
		if (!this.currentCodeVerifier) {
			throw new Error(
				`No PKCE code verifier for MCP server "${this.serverName}"; start the login again.`,
			);
		}
		return this.currentCodeVerifier;
	}

	invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): void {
		if (scope === 'verifier') {
			this.currentCodeVerifier = undefined;
			return;
		}
		if (scope !== 'client') {
			this.cachedTokens = undefined;
		}
		removeMCPOAuthCredential(this.serverUrl, scope);
	}

	redirectToAuthorization(authorizationUrl: URL): void {
		if (!this.interactive) {
			throw new MCPAuthRequiredError(this.serverName);
		}
		this.onAuthorizationUrl?.(authorizationUrl);
		if (this.shouldOpenBrowser) {
			openInBrowser(authorizationUrl);
		}
	}

	// ---------------------------------------------------------------------
	// Loopback redirect handling (interactive mode)
	// ---------------------------------------------------------------------

	/**
	 * Start the loopback listener. Must be called before `auth()` in
	 * interactive mode so `redirectUrl` carries the real port. Resolves with
	 * the redirect URL.
	 */
	async startCallbackListener(): Promise<URL> {
		if (this.pending) {
			return this.pending.redirectUrl;
		}
		const expectedState = this.state();
		let resolveCode: (code: string) => void = () => {};
		let rejectCode: (error: Error) => void = () => {};
		const code = new Promise<string>((resolve, reject) => {
			resolveCode = resolve;
			rejectCode = reject;
		});

		const server = http.createServer((req, res) => {
			const url = new URL(req.url ?? '/', 'http://127.0.0.1');
			if (url.pathname !== CALLBACK_PATH) {
				res.writeHead(404, {'Content-Type': 'text/plain'});
				res.end('Not found');
				return;
			}
			const error = url.searchParams.get('error');
			if (error) {
				const description =
					url.searchParams.get('error_description') ?? 'no description';
				const message = `Authorization server returned "${error}": ${description}`;
				res.writeHead(400, {'Content-Type': 'text/html; charset=utf-8'});
				res.end(errorHtml(message));
				rejectCode(new Error(message));
				return;
			}
			const state = url.searchParams.get('state');
			const authorizationCode = url.searchParams.get('code');
			if (state !== expectedState) {
				const message =
					'State parameter mismatch; the login was not started by this Nanocoder session.';
				res.writeHead(400, {'Content-Type': 'text/html; charset=utf-8'});
				res.end(errorHtml(message));
				// Do not reject: an unrelated or replayed request must not abort
				// the real callback that may still arrive.
				return;
			}
			if (!authorizationCode) {
				const message = 'Redirect did not include an authorization code.';
				res.writeHead(400, {'Content-Type': 'text/html; charset=utf-8'});
				res.end(errorHtml(message));
				rejectCode(new Error(message));
				return;
			}
			res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
			res.end(SUCCESS_HTML);
			resolveCode(authorizationCode);
		});

		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', () => resolve());
		});
		const {port} = server.address() as AddressInfo;
		const redirectUrl = new URL(`http://127.0.0.1:${port}${CALLBACK_PATH}`);

		const timer = setTimeout(() => {
			rejectCode(
				new Error(
					`Timed out after ${Math.round(this.callbackTimeoutMs / 1000)}s waiting for the browser sign-in to finish.`,
				),
			);
		}, this.callbackTimeoutMs);
		timer.unref();
		const settled = code.finally(() => {
			clearTimeout(timer);
			this.stopCallbackListener();
		});
		// Avoid an unhandled rejection if nobody awaits (e.g. timeout after
		// the caller gave up); the awaiting caller still sees the rejection.
		settled.catch(() => {});

		this.pending = {server, redirectUrl, code: settled};
		return redirectUrl;
	}

	/** Wait for the authorization code delivered to the loopback redirect. */
	waitForAuthorizationCode(): Promise<string> {
		if (!this.pending) {
			return Promise.reject(
				new Error(
					'Callback listener is not running; call startCallbackListener() first.',
				),
			);
		}
		return this.pending.code;
	}

	/** Stop the loopback listener (idempotent). */
	stopCallbackListener(): void {
		const pending = this.pending;
		this.pending = undefined;
		if (pending) {
			pending.server.close();
			// Drop keep-alive connections so the process can exit promptly.
			pending.server.closeAllConnections?.();
		}
	}
}

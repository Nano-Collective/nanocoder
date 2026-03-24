/**
 * ChatGPT / Codex subscription auth: OpenAI device code flow and token management.
 * Uses OpenAI's custom device code flow (NOT RFC 8628).
 * @see https://github.com/sst/opencode (reference implementation)
 *
 * CLIENT_ID: OpenAI's Codex CLI OAuth client (app_EMoamEEZ73f0CkXaXp7hrann).
 * External dependency; changing it may break device flow compatibility.
 */

const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEVICE_CODE_URL =
	'https://auth.openai.com/api/accounts/deviceauth/usercode';
const DEVICE_TOKEN_URL =
	'https://auth.openai.com/api/accounts/deviceauth/token';
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const DEVICE_AUTH_PAGE = 'https://auth.openai.com/codex/device';
const DEVICE_AUTH_CALLBACK = 'https://auth.openai.com/deviceauth/callback';

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

export interface CodexDeviceFlowResult {
	userCode: string;
	deviceAuthId: string;
	verificationUrl: string;
}

/**
 * Step 1: Request a device code from OpenAI.
 */
export async function requestCodexDeviceCode(
	fetchFn: typeof fetch = fetch,
): Promise<CodexDeviceFlowResult> {
	const res = await fetchFn(DEVICE_CODE_URL, {
		method: 'POST',
		headers: {'Content-Type': 'application/json'},
		body: JSON.stringify({client_id: OPENAI_CLIENT_ID}),
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(
			`Device code request failed (POST ${DEVICE_CODE_URL}): HTTP ${res.status} ${res.statusText}\nResponse: ${body}`,
		);
	}
	const data = (await res.json()) as {
		device_auth_id: string;
		user_code: string;
		interval: string;
	};
	return {
		userCode: data.user_code,
		deviceAuthId: data.device_auth_id,
		verificationUrl: DEVICE_AUTH_PAGE,
	};
}

/**
 * Step 2: Poll until user completes authorization. On success, exchanges the
 * authorization code for access + refresh tokens and saves credentials.
 */
export async function pollForCodexAuthorization(
	deviceAuthId: string,
	userCode: string,
	saveFn: (tokens: CodexTokens) => void,
	fetchFn: typeof fetch = fetch,
): Promise<void> {
	const deadline = Date.now() + POLL_TIMEOUT_MS;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		if (Date.now() > deadline) {
			throw new Error(
				'Authorization timed out. Please run login again and complete within 5 minutes.',
			);
		}

		await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

		try {
			const res = await fetchFn(DEVICE_TOKEN_URL, {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					device_auth_id: deviceAuthId,
					user_code: userCode,
				}),
			});

			if (res.ok) {
				const data = (await res.json()) as {
					authorization_code: string;
					code_verifier: string;
				};
				const tokens = await exchangeCodeForTokens(
					data.authorization_code,
					data.code_verifier,
					fetchFn,
				);
				saveFn(tokens);
				return;
			}

			// 403/404 = still pending, keep polling
			if (res.status === 403 || res.status === 404) {
				continue;
			}

			throw new Error(`Unexpected poll response: ${res.status}`);
		} catch (error) {
			// Re-throw timeout and non-network errors
			if (
				error instanceof Error &&
				(error.message.includes('timed out') ||
					error.message.includes('Unexpected poll'))
			) {
				throw error;
			}
			// Network errors during polling — keep trying
		}
	}
}

export interface CodexTokens {
	accessToken: string;
	refreshToken: string | undefined;
	expiresAt: number | undefined;
	accountId: string | undefined;
}

/**
 * Exchanges the authorization code + code_verifier for OAuth tokens.
 */
async function exchangeCodeForTokens(
	code: string,
	codeVerifier: string,
	fetchFn: typeof fetch = fetch,
): Promise<CodexTokens> {
	const res = await fetchFn(OPENAI_TOKEN_URL, {
		method: 'POST',
		headers: {'Content-Type': 'application/x-www-form-urlencoded'},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: OPENAI_CLIENT_ID,
			code,
			code_verifier: codeVerifier,
			redirect_uri: DEVICE_AUTH_CALLBACK,
		}).toString(),
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(
			`Token exchange failed: ${res.status} ${res.statusText}\n${body}`,
		);
	}

	const data = (await res.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in?: number;
		id_token?: string;
	};

	const accountId = extractAccountId(data.id_token ?? data.access_token);

	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresAt: data.expires_in
			? Date.now() + data.expires_in * 1000
			: undefined,
		accountId: accountId ?? undefined,
	};
}

/**
 * Extracts chatgpt_account_id from a JWT token's payload.
 */
function extractAccountId(token: string): string | null {
	try {
		const parts = token.split('.');
		if (parts.length !== 3) return null;
		const payload = JSON.parse(
			Buffer.from(parts[1], 'base64').toString('utf-8'),
		) as {
			chatgpt_account_id?: string;
			'https://api.openai.com/auth'?: {
				chatgpt_account_id?: string;
			};
			organizations?: Array<{id: string}>;
		};
		return (
			payload.chatgpt_account_id ??
			payload['https://api.openai.com/auth']?.chatgpt_account_id ??
			payload.organizations?.[0]?.id ??
			null
		);
	} catch {
		return null;
	}
}

/**
 * Refresh an expired access token using the stored refresh token.
 * Returns the new access token, or null if refresh failed.
 */
export async function refreshCodexAccessToken(
	refreshToken: string,
	fetchFn: typeof fetch = fetch,
): Promise<CodexTokens | null> {
	try {
		const res = await fetchFn(OPENAI_TOKEN_URL, {
			method: 'POST',
			headers: {'Content-Type': 'application/x-www-form-urlencoded'},
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
				client_id: OPENAI_CLIENT_ID,
			}).toString(),
		});

		if (!res.ok) {
			return null;
		}

		const data = (await res.json()) as {
			access_token: string;
			refresh_token?: string;
			expires_in?: number;
		};

		return {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresAt: data.expires_in
				? Date.now() + data.expires_in * 1000
				: undefined,
			accountId: undefined, // accountId doesn't change on refresh
		};
	} catch {
		return null;
	}
}

/**
 * Get a valid access token, refreshing if necessary.
 * Returns {accessToken, accountId} or throws if no valid credential.
 */
export async function getValidCodexToken(
	credential: {
		accessToken: string;
		refreshToken?: string;
		expiresAt?: number;
		accountId?: string;
	},
	onUpdate: (tokens: Partial<CodexTokens>) => void,
	fetchFn: typeof fetch = fetch,
): Promise<{accessToken: string; accountId: string}> {
	// If no expiry tracked or still valid, return as-is
	if (
		!credential.expiresAt ||
		Date.now() < credential.expiresAt - REFRESH_BUFFER_MS
	) {
		return {
			accessToken: credential.accessToken,
			accountId: credential.accountId ?? '',
		};
	}

	// Need to refresh
	if (!credential.refreshToken) {
		throw new Error(
			'Codex access token expired and no refresh token available. Please run /codex-login again.',
		);
	}

	const refreshed = await refreshCodexAccessToken(
		credential.refreshToken,
		fetchFn,
	);
	if (!refreshed) {
		throw new Error(
			'Failed to refresh Codex access token. Please run /codex-login again.',
		);
	}

	onUpdate(refreshed);

	return {
		accessToken: refreshed.accessToken,
		accountId: credential.accountId ?? '',
	};
}

/**
 * Run the full Codex device-flow login: request code, show to user, poll, save.
 * Shared by CLI (cli.tsx) and in-chat UI (codex-login.tsx).
 */
export async function runCodexLoginFlow(
	providerName: string,
	options: {
		onShowCode: (verificationUrl: string, userCode: string) => void;
		onPollingStart?: () => void;
		delayBeforePollMs?: number;
		fetchFn?: typeof fetch;
	},
): Promise<void> {
	const {
		onShowCode,
		onPollingStart,
		delayBeforePollMs = 0,
		fetchFn = fetch,
	} = options;
	const {saveCodexCredential} = await import('@/config/codex-credentials');
	const flow = await requestCodexDeviceCode(fetchFn);
	onShowCode(flow.verificationUrl, flow.userCode);
	if (delayBeforePollMs > 0) {
		await new Promise(r => setTimeout(r, delayBeforePollMs));
	}
	onPollingStart?.();
	await pollForCodexAuthorization(
		flow.deviceAuthId,
		flow.userCode,
		tokens => {
			saveCodexCredential(providerName, tokens);
		},
		fetchFn,
	);
}

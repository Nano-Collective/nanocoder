/**
 * GitHub Copilot subscription auth: device OAuth flow and token refresh.
 * Uses the same approach as opencode-copilot-auth for compatibility.
 * @see https://github.com/anomalyco/opencode-copilot-auth
 *
 * CLIENT_ID: VS Code Copilot OAuth client (Iv1.b507a08c87ecfe98). External
 * dependency; changing it may break device flow compatibility.
 */

const GITHUB_COM = 'github.com';
const CLIENT_ID = 'Iv1.b507a08c87ecfe98';

/** Headers required by Copilot API; export for reuse in provider-factory. */
export const COPILOT_HEADERS: Record<string, string> = {
	'User-Agent': 'GitHubCopilotChat/0.35.0',
	'Editor-Version': 'vscode/1.107.0',
	'Editor-Plugin-Version': 'copilot-chat/0.35.0',
	'Copilot-Integration-Id': 'vscode-chat',
};

function normalizeDomain(url: string): string {
	return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function getCopilotUrls(domain: string): {
	deviceCodeUrl: string;
	accessTokenUrl: string;
	copilotTokenUrl: string;
} {
	const base = `https://${normalizeDomain(domain)}`;
	return {
		deviceCodeUrl: `${base}/login/device/code`,
		accessTokenUrl: `${base}/login/oauth/access_token`,
		copilotTokenUrl:
			domain === GITHUB_COM
				? 'https://api.github.com/copilot_internal/v2/token'
				: `https://api.${normalizeDomain(domain)}/copilot_internal/v2/token`,
	};
}

export interface DeviceFlowResult {
	verificationUri: string;
	userCode: string;
	deviceCode: string;
	interval: number;
}

/**
 * Start GitHub device OAuth flow. User must visit verificationUri and enter userCode.
 * @internal Used by runCopilotLoginFlow.
 */
async function startDeviceFlow(
	domain: string = GITHUB_COM,
	fetchFn: typeof fetch = fetch,
): Promise<DeviceFlowResult> {
	const urls = getCopilotUrls(domain);
	const res = await fetchFn(urls.deviceCodeUrl, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			'User-Agent': 'GitHubCopilotChat/0.35.0',
		},
		body: JSON.stringify({
			client_id: CLIENT_ID,
			scope: 'read:user',
		}),
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(
			`Device code request failed (POST ${urls.deviceCodeUrl}): HTTP ${res.status} ${res.statusText}\nResponse: ${body}`,
		);
	}
	const data = (await res.json()) as {
		device_code: string;
		user_code: string;
		verification_uri: string;
		interval: number;
	};
	return {
		deviceCode: data.device_code,
		userCode: data.user_code,
		verificationUri: data.verification_uri,
		interval: typeof data.interval === 'number' ? data.interval : 5,
	};
}

/**
 * Poll until user completes device flow; returns the GitHub OAuth access token
 * (the `access_token` from the response). This token is stored as the credential
 * and used to obtain short-lived Copilot API tokens via getCopilotAccessToken.
 * @internal Used by runCopilotLoginFlow.
 */
const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

async function pollForOAuthToken(
	deviceCode: string,
	intervalSeconds: number,
	domain: string = GITHUB_COM,
	fetchFn: typeof fetch = fetch,
): Promise<string> {
	const urls = getCopilotUrls(domain);
	const intervalMs = Math.max(intervalSeconds * 1000, 1000);
	const deadline = Date.now() + POLL_TIMEOUT_MS;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		if (Date.now() > deadline) {
			throw new Error(
				'Device code flow timed out. Please run login again and complete the flow within 15 minutes.',
			);
		}
		const res = await fetchFn(urls.accessTokenUrl, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'User-Agent': 'GitHubCopilotChat/0.35.0',
			},
			body: JSON.stringify({
				client_id: CLIENT_ID,
				device_code: deviceCode,
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
			}),
		});

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`Token exchange failed: ${res.status} ${text}`);
		}

		const data = (await res.json()) as {
			access_token?: string;
			error?: string;
		};

		if (data.access_token) {
			return data.access_token;
		}

		if (data.error === 'authorization_pending') {
			await new Promise(r => setTimeout(r, intervalMs));
			continue;
		}

		if (data.error === 'expired_token') {
			throw new Error('Device code expired. Please run login again.');
		}

		if (data.error) {
			throw new Error(`Authorization failed: ${data.error}`);
		}

		await new Promise(r => setTimeout(r, intervalMs));
	}
}

export interface CopilotTokenResult {
	token: string;
	expiresAt: number;
}

let cachedToken: {key: string; result: CopilotTokenResult} | null = null;

/**
 * Get a short-lived access token for the Copilot API using the stored GitHub OAuth
 * token (from device flow). Caches the result until close to expiry (5 min buffer).
 * Cache key uses full token so different tokens never share an entry; key is only
 * used in-process for lookup, not stored or logged.
 */
function tokenCacheKey(githubOAuthToken: string, domain: string): string {
	return `${domain}:${githubOAuthToken}`;
}

/**
 * Clear the in-memory Copilot token cache so the next request fetches a new token.
 * Use after credential change or logout so credentials can be invalidated without waiting for expiry.
 */
export function clearCopilotTokenCache(): void {
	cachedToken = null;
}

export async function getCopilotAccessToken(
	githubOAuthToken: string,
	domain: string = GITHUB_COM,
	fetchFn: typeof fetch = fetch,
): Promise<CopilotTokenResult> {
	const cacheKey = tokenCacheKey(githubOAuthToken, domain);
	const now = Date.now();
	if (cachedToken?.key === cacheKey && cachedToken.result.expiresAt > now) {
		return cachedToken.result;
	}

	const urls = getCopilotUrls(domain);
	const res = await fetchFn(urls.copilotTokenUrl, {
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${githubOAuthToken}`,
			...COPILOT_HEADERS,
		},
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Copilot token refresh failed: ${res.status} ${text}`);
	}

	const data = (await res.json()) as {token?: string; expires_at?: number};
	if (!data.token || typeof data.token !== 'string') {
		throw new Error(
			'Copilot token endpoint returned no token. Your Copilot subscription may not include chat access.',
		);
	}
	const expiresAt = (data.expires_at ?? 0) * 1000 - 5 * 60 * 1000; // 5 min buffer
	const result: CopilotTokenResult = {token: data.token, expiresAt};
	cachedToken = {key: cacheKey, result};
	return result;
}

export function getCopilotBaseUrl(domain: string): string {
	if (domain === GITHUB_COM) {
		return 'https://api.githubcopilot.com';
	}
	return `https://copilot-api.${normalizeDomain(domain)}`;
}

/**
 * Run the full Copilot device-flow login: start flow, show code via callback, poll for token, save credential.
 * Shared by CLI (cli.tsx) and in-chat UI (copilot-login.tsx) so the flow logic lives in one place.
 */
export async function runCopilotLoginFlow(
	providerName: string,
	options: {
		onShowCode: (verificationUri: string, userCode: string) => void;
		onPollingStart?: () => void;
		delayBeforePollMs?: number;
		domain?: string;
		fetchFn?: typeof fetch;
	},
): Promise<void> {
	const {
		onShowCode,
		onPollingStart,
		delayBeforePollMs = 0,
		domain = GITHUB_COM,
		fetchFn = fetch,
	} = options;
	const {saveCopilotCredential} = await import('@/config/copilot-credentials');
	const flow = await startDeviceFlow(domain, fetchFn);
	onShowCode(flow.verificationUri, flow.userCode);
	if (delayBeforePollMs > 0) {
		await new Promise(r => setTimeout(r, delayBeforePollMs));
	}
	onPollingStart?.();
	const oauthToken = await pollForOAuthToken(
		flow.deviceCode,
		flow.interval,
		domain,
		fetchFn,
	);
	saveCopilotCredential(providerName, oauthToken);
}

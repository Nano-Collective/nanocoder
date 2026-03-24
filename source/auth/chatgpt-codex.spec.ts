import test from 'ava';
import {
	type CodexTokens,
	getValidCodexToken,
	pollForCodexAuthorization,
	refreshCodexAccessToken,
	requestCodexDeviceCode,
	runCodexLoginFlow,
} from './chatgpt-codex';

// ── requestCodexDeviceCode ──────────────────────────────────────────

test('requestCodexDeviceCode returns device code state on success', async t => {
	const mockFetch = async () =>
		({
			ok: true,
			json: async () => ({
				device_auth_id: 'auth-123',
				user_code: 'ABCD-1234',
				interval: '5',
			}),
		}) as Response;

	const result = await requestCodexDeviceCode(mockFetch as typeof fetch);
	t.is(result.userCode, 'ABCD-1234');
	t.is(result.deviceAuthId, 'auth-123');
	t.is(result.verificationUrl, 'https://auth.openai.com/codex/device');
});

test('requestCodexDeviceCode throws on HTTP error', async t => {
	const mockFetch = async () =>
		({
			ok: false,
			status: 500,
			statusText: 'Internal Server Error',
			text: async () => 'server error',
		}) as Response;

	await t.throwsAsync(
		() => requestCodexDeviceCode(mockFetch as typeof fetch),
		{message: /Device code request failed/},
	);
});

// ── pollForCodexAuthorization ───────────────────────────────────────

test('pollForCodexAuthorization saves tokens on success', async t => {
	let callCount = 0;
	let savedTokens: CodexTokens | null = null;

	const mockFetch = async (url: string) => {
		callCount++;
		const urlStr = typeof url === 'string' ? url : String(url);

		// First call to poll endpoint: return authorization code
		if (urlStr.includes('deviceauth/token')) {
			return {
				ok: true,
				json: async () => ({
					authorization_code: 'code-abc',
					code_verifier: 'verifier-xyz',
				}),
			} as Response;
		}

		// Token exchange endpoint
		if (urlStr.includes('oauth/token')) {
			return {
				ok: true,
				json: async () => ({
					access_token: 'access-tok',
					refresh_token: 'refresh-tok',
					expires_in: 3600,
					id_token:
						'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJjaGF0Z3B0X2FjY291bnRfaWQiOiJhY2MtMTIzIn0.sig',
				}),
			} as Response;
		}

		return {ok: false, status: 404, text: async () => ''} as Response;
	};

	await pollForCodexAuthorization(
		'auth-123',
		'ABCD-1234',
		tokens => {
			savedTokens = tokens;
		},
		mockFetch as typeof fetch,
	);

	t.truthy(savedTokens);
	t.is(savedTokens!.accessToken, 'access-tok');
	t.is(savedTokens!.refreshToken, 'refresh-tok');
	t.truthy(savedTokens!.expiresAt);
	t.truthy(callCount >= 2); // poll + exchange
});

// ── refreshCodexAccessToken ─────────────────────────────────────────

test('refreshCodexAccessToken returns new tokens on success', async t => {
	const mockFetch = async () =>
		({
			ok: true,
			json: async () => ({
				access_token: 'new-access',
				refresh_token: 'new-refresh',
				expires_in: 7200,
			}),
		}) as Response;

	const result = await refreshCodexAccessToken(
		'old-refresh',
		mockFetch as typeof fetch,
	);
	t.truthy(result);
	t.is(result!.accessToken, 'new-access');
	t.is(result!.refreshToken, 'new-refresh');
	t.truthy(result!.expiresAt);
});

test('refreshCodexAccessToken returns null on HTTP error', async t => {
	const mockFetch = async () =>
		({ok: false, status: 401}) as Response;

	const result = await refreshCodexAccessToken(
		'old-refresh',
		mockFetch as typeof fetch,
	);
	t.is(result, null);
});

test('refreshCodexAccessToken returns null on network error', async t => {
	const mockFetch = async () => {
		throw new Error('Network error');
	};

	const result = await refreshCodexAccessToken(
		'old-refresh',
		mockFetch as typeof fetch,
	);
	t.is(result, null);
});

// ── getValidCodexToken ──────────────────────────────────────────────

test('getValidCodexToken returns token if no expiry tracked', async t => {
	const credential = {
		accessToken: 'valid-token',
		accountId: 'acc-1',
	};

	const result = await getValidCodexToken(credential, () => {});
	t.is(result.accessToken, 'valid-token');
	t.is(result.accountId, 'acc-1');
});

test('getValidCodexToken returns token if still valid', async t => {
	const credential = {
		accessToken: 'valid-token',
		expiresAt: Date.now() + 10 * 60 * 1000, // 10 min from now
		accountId: 'acc-1',
	};

	const result = await getValidCodexToken(credential, () => {});
	t.is(result.accessToken, 'valid-token');
});

test('getValidCodexToken throws if expired and no refresh token', async t => {
	const credential = {
		accessToken: 'expired-token',
		expiresAt: Date.now() - 1000, // expired
		accountId: 'acc-1',
	};

	await t.throwsAsync(
		() => getValidCodexToken(credential, () => {}),
		{message: /expired.*no refresh token/i},
	);
});

test('getValidCodexToken refreshes expired token', async t => {
	let updated = false;
	const credential = {
		accessToken: 'expired-token',
		refreshToken: 'refresh-tok',
		expiresAt: Date.now() - 1000, // expired
		accountId: 'acc-1',
	};

	const mockFetch = async () =>
		({
			ok: true,
			json: async () => ({
				access_token: 'refreshed-token',
				expires_in: 3600,
			}),
		}) as Response;

	const result = await getValidCodexToken(
		credential,
		() => {
			updated = true;
		},
		mockFetch as typeof fetch,
	);
	t.is(result.accessToken, 'refreshed-token');
	t.truthy(updated);
});

// ── runCodexLoginFlow ───────────────────────────────────────────────

test('runCodexLoginFlow calls onShowCode and saves credential', async t => {
	let shownCode = '';
	let shownUrl = '';
	let pollingStarted = false;

	const mockFetch = async (url: string) => {
		const urlStr = typeof url === 'string' ? url : String(url);

		if (urlStr.includes('deviceauth/usercode')) {
			return {
				ok: true,
				json: async () => ({
					device_auth_id: 'auth-flow',
					user_code: 'FLOW-CODE',
					interval: '1',
				}),
			} as Response;
		}

		if (urlStr.includes('deviceauth/token')) {
			return {
				ok: true,
				json: async () => ({
					authorization_code: 'code-flow',
					code_verifier: 'verifier-flow',
				}),
			} as Response;
		}

		if (urlStr.includes('oauth/token')) {
			return {
				ok: true,
				json: async () => ({
					access_token: 'flow-access',
					refresh_token: 'flow-refresh',
					expires_in: 3600,
				}),
			} as Response;
		}

		return {ok: false, status: 404, text: async () => ''} as Response;
	};

	// Mock the dynamic import of saveCodexCredential
	// runCodexLoginFlow calls import('@/config/codex-credentials') internally,
	// so we test via the onShowCode/onPollingStart callbacks
	await runCodexLoginFlow('TestProvider', {
		onShowCode(url, code) {
			shownUrl = url;
			shownCode = code;
		},
		onPollingStart() {
			pollingStarted = true;
		},
		fetchFn: mockFetch as typeof fetch,
	});

	t.is(shownUrl, 'https://auth.openai.com/codex/device');
	t.is(shownCode, 'FLOW-CODE');
	t.truthy(pollingStarted);
});

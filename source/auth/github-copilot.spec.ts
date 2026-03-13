import test from 'ava';
import {
  getCopilotUrls,
  getCopilotBaseUrl,
  getCopilotAccessToken,
} from './github-copilot.js';

test('getCopilotUrls returns correct URLs for github.com', t => {
  const urls = getCopilotUrls('github.com');
  t.is(urls.deviceCodeUrl, 'https://github.com/login/device/code');
  t.is(urls.accessTokenUrl, 'https://github.com/login/oauth/access_token');
  t.is(urls.copilotTokenUrl, 'https://api.github.com/copilot_internal/v2/token');
});

test('getCopilotUrls returns correct URLs for enterprise domains', t => {
  const urls = getCopilotUrls('github.enterprise.com');
  t.is(urls.deviceCodeUrl, 'https://github.enterprise.com/login/device/code');
  t.is(urls.accessTokenUrl, 'https://github.enterprise.com/login/oauth/access_token');
  t.is(urls.copilotTokenUrl, 'https://api.github.enterprise.com/copilot_internal/v2/token');
});

test('getCopilotBaseUrl returns correct base URL', t => {
  t.is(getCopilotBaseUrl('github.com'), 'https://api.githubcopilot.com');
  t.is(getCopilotBaseUrl('github.enterprise.com'), 'https://copilot-api.github.enterprise.com');
});

test('getCopilotAccessToken uses caching', async t => {
  let fetchCallCount = 0;
  const mockFetch = async () => {
    fetchCallCount += 1;
    return {
      ok: true,
      json: async () => ({
        token: 'test-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    } as Response;
  };

  const githubOAuthToken = `cache-test-${Date.now()}`;
  const result1 = await getCopilotAccessToken(
    githubOAuthToken,
    'github.com',
    mockFetch as typeof fetch,
  );
  t.truthy(result1.token);
  t.truthy(result1.expiresAt);

  const result2 = await getCopilotAccessToken(
    githubOAuthToken,
    'github.com',
    mockFetch as typeof fetch,
  );

  t.is(fetchCallCount, 1, 'fetch must be called only once; second call should use cache');
  t.is(result1, result2, 'second call must return the same cached object reference');
});

test('getCopilotAccessToken refetches when cached token is expired', async t => {
  let fetchCallCount = 0;
  const mockFetch = async () => {
    fetchCallCount += 1;
    return {
      ok: true,
      json: async () => ({
        token: `token-${fetchCallCount}`,
        expires_at: Math.floor(Date.now() / 1000) - 60,
      }),
    } as Response;
  };

  const githubOAuthToken = `expired-cache-${Date.now()}`;
  const result1 = await getCopilotAccessToken(
    githubOAuthToken,
    'github.com',
    mockFetch as typeof fetch,
  );
  t.truthy(result1.token);

  const result2 = await getCopilotAccessToken(
    githubOAuthToken,
    'github.com',
    mockFetch as typeof fetch,
  );
  t.truthy(result2.token);

  t.is(fetchCallCount, 2, 'fetch must be called twice; expired cache should not be used');
  t.not(result1.token, result2.token, 'second call should return a new token');
});

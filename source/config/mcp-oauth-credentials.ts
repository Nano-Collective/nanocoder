/**
 * User-level storage for OAuth credentials of remote MCP servers.
 *
 * Keyed by the server URL rather than its config name, so the same hosted
 * server configured under two names (or in two projects) shares one login,
 * and a renamed entry does not orphan its tokens. Stored under the config
 * path (e.g. ~/.config/nanocoder/) with 0600 permissions, like the Copilot
 * and Codex credentials, so tokens never land in a project directory.
 */

import type {
	OAuthClientInformationMixed,
	OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import {createJsonCredentialStore} from '@/config/json-credential-store';

const FILENAME = 'mcp-oauth-credentials.json';

export interface MCPOAuthCredential {
	/** Client registration obtained via dynamic client registration. */
	clientInformation?: OAuthClientInformationMixed;
	/** Access/refresh tokens issued by the authorization server. */
	tokens?: OAuthTokens;
	/** Epoch milliseconds when `tokens` were saved, for expiry bookkeeping. */
	tokensSavedAt?: number;
}

const credentialStore = createJsonCredentialStore<MCPOAuthCredential>(FILENAME);

/**
 * Normalizes a server URL into the store key: no hash, no trailing slash,
 * lowercase host. Two spellings of one endpoint map to one login.
 */
export function mcpOAuthCredentialKey(serverUrl: string): string {
	try {
		const url = new URL(serverUrl);
		url.hash = '';
		url.hostname = url.hostname.toLowerCase();
		const key = url.toString();
		return key.endsWith('/') && url.pathname === '/' ? key.slice(0, -1) : key;
	} catch {
		return serverUrl;
	}
}

export function loadMCPOAuthCredential(
	serverUrl: string,
): MCPOAuthCredential | null {
	const store = credentialStore.load();
	const entry = store[mcpOAuthCredentialKey(serverUrl)];
	if (!entry || typeof entry !== 'object') {
		return null;
	}
	return entry;
}

/** Merge `patch` into the stored credential for `serverUrl`. */
export function saveMCPOAuthCredential(
	serverUrl: string,
	patch: Partial<MCPOAuthCredential>,
): void {
	const store = credentialStore.load();
	const key = mcpOAuthCredentialKey(serverUrl);
	store[key] = {...(store[key] ?? {}), ...patch};
	credentialStore.write(store);
}

/**
 * Remove stored credentials for `serverUrl`. `scope` limits the removal to
 * the tokens (keeping the client registration) or the client registration.
 * Returns true when something was removed.
 */
export function removeMCPOAuthCredential(
	serverUrl: string,
	scope: 'all' | 'tokens' | 'client' = 'all',
): boolean {
	const store = credentialStore.load();
	const key = mcpOAuthCredentialKey(serverUrl);
	const entry = store[key];
	if (!entry) {
		return false;
	}
	if (scope === 'all') {
		delete store[key];
	} else if (scope === 'tokens') {
		delete entry.tokens;
		delete entry.tokensSavedAt;
	} else {
		delete entry.clientInformation;
	}
	credentialStore.write(store);
	return true;
}

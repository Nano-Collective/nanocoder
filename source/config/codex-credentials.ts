/**
 * User-level storage for ChatGPT/Codex OAuth credentials.
 * Stores access token, refresh token, expiry, and account ID.
 * Stored under config path (e.g. ~/.config/nanocoder/) so they are not in project config.
 */

import type {CodexTokens} from '@/auth/chatgpt-codex';
import {createJsonCredentialStore} from '@/config/json-credential-store';

const FILENAME = 'codex-credentials.json';

/** Shared message when no Codex credential is found. */
export function getCodexNoCredentialsMessage(providerName: string): string {
	return `No Codex credentials for "${providerName}". Type /codex-login in the chat to log in, or run: nanocoder codex login`;
}

export interface CodexCredential {
	accessToken: string;
	refreshToken?: string;
	expiresAt?: number;
	accountId?: string;
}

const credentialStore = createJsonCredentialStore<CodexCredential>(FILENAME);

/**
 * Get stored Codex credential for a provider name (e.g. "ChatGPT").
 */
export function loadCodexCredential(
	providerName: string,
): CodexCredential | null {
	const store = credentialStore.load();
	const entry = store[providerName];
	if (!entry || typeof entry.accessToken !== 'string') {
		return null;
	}
	return {
		accessToken: entry.accessToken,
		refreshToken:
			typeof entry.refreshToken === 'string' ? entry.refreshToken : undefined,
		expiresAt:
			typeof entry.expiresAt === 'number' ? entry.expiresAt : undefined,
		accountId:
			typeof entry.accountId === 'string' ? entry.accountId : undefined,
	};
}

/**
 * Save Codex credential from device flow tokens.
 */
export function saveCodexCredential(
	providerName: string,
	tokens: CodexTokens,
): void {
	const store = credentialStore.load();
	store[providerName] = {
		accessToken: tokens.accessToken,
		refreshToken: tokens.refreshToken,
		expiresAt: tokens.expiresAt,
		accountId: tokens.accountId,
	};
	credentialStore.write(store);
}

/**
 * Update specific fields of a stored credential (e.g. after token refresh).
 */
export function updateCodexCredential(
	providerName: string,
	updates: Partial<CodexCredential>,
): void {
	const store = credentialStore.load();
	const existing = store[providerName];
	if (!existing) return;
	store[providerName] = {...existing, ...updates};
	credentialStore.write(store);
}

/**
 * Remove stored credential for a provider name.
 */
export function removeCodexCredential(providerName: string): void {
	const store = credentialStore.load();
	if (providerName in store) {
		delete store[providerName];
		credentialStore.write(store);
	}
}

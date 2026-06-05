/**
 * User-level storage for GitHub Copilot credentials.
 * The stored token is the GitHub OAuth access token from the device flow
 * (used to obtain short-lived Copilot API tokens). Stored under config path
 * (e.g. ~/.config/nanocoder/) so they are not in project config.
 */

import {clearCopilotTokenCache} from '@/auth/github-copilot';
import {createJsonCredentialStore} from '@/config/json-credential-store';

const FILENAME = 'copilot-credentials.json';

/** Shared message when no Copilot credential is found (used by provider-factory and client-factory). */
export function getCopilotNoCredentialsMessage(providerName: string): string {
	return `No Copilot credentials for "${providerName}". Type /copilot-login in the chat to log in, or run: nanocoder copilot login (from project: node dist/cli.js copilot login)`;
}

export interface CopilotCredential {
	/** GitHub OAuth access token from device flow. */
	oauthToken: string;
	enterpriseUrl?: string;
}

const credentialStore = createJsonCredentialStore<CopilotCredential>(FILENAME);

/**
 * Get stored Copilot credential for a provider name (e.g. "GitHub Copilot").
 */
export function loadCopilotCredential(
	providerName: string,
): CopilotCredential | null {
	const store = credentialStore.load();
	const entry = store[providerName];
	if (!entry || typeof entry.oauthToken !== 'string') {
		return null;
	}
	return {
		oauthToken: entry.oauthToken,
		enterpriseUrl:
			typeof entry.enterpriseUrl === 'string' ? entry.enterpriseUrl : undefined,
	};
}

/**
 * Save GitHub OAuth token (from device flow) for a provider name.
 */
export function saveCopilotCredential(
	providerName: string,
	oauthToken: string,
	enterpriseUrl?: string,
): void {
	const store = credentialStore.load();
	store[providerName] = {oauthToken, enterpriseUrl};
	credentialStore.write(store);
}

/**
 * Remove stored credential for a provider name.
 */
export function removeCopilotCredential(providerName: string): void {
	const store = credentialStore.load();
	if (providerName in store) {
		delete store[providerName];
		credentialStore.write(store);
		clearCopilotTokenCache();
	}
}

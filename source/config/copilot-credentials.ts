/**
 * User-level storage for GitHub Copilot credentials.
 * The stored token is the GitHub OAuth access token from the device flow
 * (used to obtain short-lived Copilot API tokens). Stored under config path
 * (e.g. ~/.config/nanocoder/) so they are not in project config.
 */

import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'fs';
import {join} from 'path';
import {clearCopilotTokenCache} from '@/auth/github-copilot';
import {getConfigPath} from '@/config/paths';

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

export type CopilotCredentialsStore = Record<string, CopilotCredential>;

function getCredentialsPath(): string {
	return join(getConfigPath(), FILENAME);
}

function loadStore(): CopilotCredentialsStore {
	const path = getCredentialsPath();
	if (!existsSync(path)) {
		return {};
	}
	try {
		const raw = readFileSync(path, 'utf-8');
		const data = JSON.parse(raw) as unknown;
		if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
			return data as CopilotCredentialsStore;
		}
	} catch {
		// Invalid or unreadable
	}
	return {};
}

function writeStore(store: CopilotCredentialsStore): void {
	const dir = getConfigPath();
	if (!existsSync(dir)) {
		mkdirSync(dir, {recursive: true});
	}
	const filePath = getCredentialsPath();
	writeFileSync(filePath, JSON.stringify(store, null, 2), {
		encoding: 'utf-8',
		mode: 0o600,
	});
	chmodSync(filePath, 0o600);
}

/**
 * Get stored Copilot credential for a provider name (e.g. "GitHub Copilot").
 */
export function loadCopilotCredential(
	providerName: string,
): CopilotCredential | null {
	const store = loadStore();
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
	const store = loadStore();
	store[providerName] = {oauthToken, enterpriseUrl};
	writeStore(store);
}

/**
 * Remove stored credential for a provider name.
 */
export function removeCopilotCredential(providerName: string): void {
	const store = loadStore();
	if (providerName in store) {
		delete store[providerName];
		writeStore(store);
		clearCopilotTokenCache();
	}
}

/**
 * User-level storage for ChatGPT/Codex OAuth credentials.
 * Stores access token, refresh token, expiry, and account ID.
 * Stored under config path (e.g. ~/.config/nanocoder/) so they are not in project config.
 */

import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'fs';
import {join} from 'path';
import type {CodexTokens} from '@/auth/chatgpt-codex';
import {getConfigPath} from '@/config/paths';

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

export type CodexCredentialsStore = Record<string, CodexCredential>;

function getCredentialsPath(): string {
	return join(getConfigPath(), FILENAME);
}

function loadStore(): CodexCredentialsStore {
	const path = getCredentialsPath();
	if (!existsSync(path)) {
		return {};
	}
	try {
		const raw = readFileSync(path, 'utf-8');
		const data = JSON.parse(raw) as unknown;
		if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
			return data as CodexCredentialsStore;
		}
	} catch {
		// Invalid or unreadable
	}
	return {};
}

function writeStore(store: CodexCredentialsStore): void {
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
 * Get stored Codex credential for a provider name (e.g. "ChatGPT").
 */
export function loadCodexCredential(
	providerName: string,
): CodexCredential | null {
	const store = loadStore();
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
	const store = loadStore();
	store[providerName] = {
		accessToken: tokens.accessToken,
		refreshToken: tokens.refreshToken,
		expiresAt: tokens.expiresAt,
		accountId: tokens.accountId,
	};
	writeStore(store);
}

/**
 * Update specific fields of a stored credential (e.g. after token refresh).
 */
export function updateCodexCredential(
	providerName: string,
	updates: Partial<CodexCredential>,
): void {
	const store = loadStore();
	const existing = store[providerName];
	if (!existing) return;
	store[providerName] = {...existing, ...updates};
	writeStore(store);
}

/**
 * Remove stored credential for a provider name.
 */
export function removeCodexCredential(providerName: string): void {
	const store = loadStore();
	if (providerName in store) {
		delete store[providerName];
		writeStore(store);
	}
}

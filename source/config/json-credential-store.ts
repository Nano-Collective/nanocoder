/**
 * Shared JSON-file persistence for user-level credential stores.
 *
 * Both the Codex and Copilot credential modules persist a
 * `Record<providerName, Credential>` to a 0600 file under the config path
 * (e.g. ~/.config/nanocoder/). This factory owns that identical read/write
 * logic; callers layer their own credential-shaped accessors on top.
 */

import {existsSync, mkdirSync, readFileSync} from 'fs';
import {join} from 'path';
import {getConfigPath} from '@/config/paths';
import {atomicWriteFileSync} from '@/utils/atomic-write';

export interface JsonCredentialStore<T> {
	/** Read the full store, returning {} if missing or unreadable. */
	load(): Record<string, T>;
	/** Persist the full store with 0600 permissions, creating the dir if needed. */
	write(store: Record<string, T>): void;
}

export function createJsonCredentialStore<T>(
	filename: string,
): JsonCredentialStore<T> {
	const filePath = () => join(getConfigPath(), filename); // nosemgrep

	return {
		load() {
			const path = filePath();
			if (!existsSync(path)) {
				return {};
			}
			try {
				const data = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
				if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
					return data as Record<string, T>;
				}
			} catch {
				// Invalid or unreadable
			}
			return {};
		},

		write(store) {
			const dir = getConfigPath();
			if (!existsSync(dir)) {
				mkdirSync(dir, {recursive: true});
			}
			// A temp file created 0600 and renamed into place: the secrets are
			// never in a file with wider permissions (an existing file's mode
			// would otherwise apply until a follow-up chmod), and a crash
			// mid-write cannot truncate the store.
			atomicWriteFileSync(filePath(), JSON.stringify(store, null, 2), {
				mode: 0o600,
			});
		},
	};
}

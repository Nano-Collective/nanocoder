import path from 'node:path';
import type {UserPreferences} from '@/types/index';

export interface DirectoryTrustDeps {
	loadPreferences: () => UserPreferences;
	savePreferences: (preferences: UserPreferences) => void;
}

export interface DirectoryTrustResult {
	trusted: boolean;
	/**
	 * True when this call persisted the directory into
	 * `preferences.trustedDirectories` (via the explicit
	 * `--trust-directory` flag or NANOCODER_TRUST_DIRECTORY=1).
	 */
	markedTrusted: boolean;
}

/**
 * Non-interactive trust gate for the daemon boot paths, with the same rules
 * as the plain shell: the project root is trusted when the caller passes
 * `--trust-directory`, when it is already listed in
 * `preferences.trustedDirectories` (set by an earlier interactive run), or
 * when NANOCODER_TRUST_DIRECTORY=1 marks it trusted.
 *
 * The gate exists because the daemon arms skill subscriptions and dispatches
 * subagents in headless mode, where tool confirmations are skipped — booting
 * one for an untrusted directory hands its `.nanocoder/` content unattended
 * execution.
 *
 * Both paths that can boot a daemon go through this check: the
 * `nanocoder daemon start` CLI (which refuses with a user-facing message) and
 * the daemon process itself (`entry.ts`, which also covers launchd/systemd
 * autostart boots that never run the CLI).
 */
export function ensureDirectoryTrust(
	directory: string,
	trustDirectoryFlag: boolean,
	deps: DirectoryTrustDeps,
): DirectoryTrustResult {
	const projectRoot = path.resolve(directory); // nosemgrep
	if (trustDirectoryFlag) {
		return {trusted: true, markedTrusted: markTrusted(projectRoot, deps)};
	}

	const preferences = deps.loadPreferences();
	const trusted = (preferences.trustedDirectories ?? []).some(
		dir => path.resolve(dir) === projectRoot, // nosemgrep
	);
	if (trusted) {
		return {trusted: true, markedTrusted: false};
	}

	if (process.env.NANOCODER_TRUST_DIRECTORY === '1') {
		return {trusted: true, markedTrusted: markTrusted(projectRoot, deps)};
	}

	return {trusted: false, markedTrusted: false};
}

/**
 * Record standing trust for the project root. The daemon boots detached (and
 * may boot again via autostart without the CLI), so an explicit trust request
 * must be visible to the boot gate, not just to the invoking shell.
 */
function markTrusted(projectRoot: string, deps: DirectoryTrustDeps): boolean {
	const preferences = deps.loadPreferences();
	const trustedDirectories = preferences.trustedDirectories ?? [];
	if (trustedDirectories.some(dir => path.resolve(dir) === projectRoot)) {
		// nosemgrep
		return false;
	}
	trustedDirectories.push(projectRoot);
	deps.savePreferences({...preferences, trustedDirectories});
	return true;
}

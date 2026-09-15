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
 * True when `--trust-directory` shows up anywhere in a daemon invocation's
 * argv. Deliberately position-agnostic: the general CLI parser accepts the
 * flag before or after the subcommand, and `cli.tsx`'s daemon fast path
 * short-circuits before that parser runs, so both have to agree on
 * `nanocoder --trust-directory daemon start` as well as on
 * `nanocoder daemon start --trust-directory`.
 */
export function hasTrustDirectoryFlag(args: readonly string[]): boolean {
	return args.includes('--trust-directory');
}

/**
 * Non-interactive trust gate for the daemon boot paths, with the same rules
 * as the plain shell: the project root is trusted when the caller passes
 * `--trust-directory`, when it is already listed in
 * `preferences.trustedDirectories` (set by an earlier interactive run), or
 * when NANOCODER_TRUST_DIRECTORY=1 marks it trusted.
 *
 * One rule intentionally differs from `plain/shell.ts`'s private helper of
 * the same name: here `--trust-directory` also records standing trust (see
 * `markTrusted`), while the plain shell only skips the prompt for that run.
 * The daemon survives the spawn and can boot again from autostart without
 * any flag, so a run-scoped trust would let the next boot fall back to
 * "untrusted" for a directory the user just asked to trust. Keep that
 * difference in mind when editing either helper — see the pointer in
 * `plain/shell.ts`.
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

export interface DaemonBootTrustResult {
	trusted: boolean;
	/** Line to print before exiting non-zero when `trusted` is false. */
	message: string;
}

/**
 * Boot-time gate for `entry.ts`, factored out of the entry point so the rule
 * can be tested without importing a module that calls `main()` on load.
 *
 * `entry.ts` is the only thing covering autostart boots (launchd/systemd,
 * registered by `daemon install`), which never run the CLI, so this has to
 * hold even when no `--trust-directory` was involved: the flag is off here on
 * purpose and the decision rests on persisted trust or
 * NANOCODER_TRUST_DIRECTORY=1.
 */
export function checkDaemonBootTrust(
	projectRoot: string,
	deps: DirectoryTrustDeps,
): DaemonBootTrustResult {
	const trust = ensureDirectoryTrust(projectRoot, false, deps);
	if (trust.trusted) {
		return {trusted: true, message: ''};
	}
	return {
		trusted: false,
		message:
			`Refusing to start the daemon for ${projectRoot}: the directory is not trusted. ` +
			'Run nanocoder interactively in this directory once to trust it, or set ' +
			'NANOCODER_TRUST_DIRECTORY=1 for this boot.',
	};
}

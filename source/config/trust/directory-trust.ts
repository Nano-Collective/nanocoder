import path from 'node:path';
import {loadPreferences, savePreferences} from '@/config/preferences';
import type {TrustedDirectoryRecord} from '@/types/config';
import type {UserPreferences} from '@/types/index';
import {describeProjectTrust, TRUST_FINGERPRINT_VERSION} from './project-trust';

/**
 * Directory trust: which folders the user has approved, keyed by a
 * fingerprint of what each folder will run (see project-trust.ts). Stored
 * in the user's preferences under `trustedDirectories`.
 */

/** The path a trust entry names, or null for a hand-edited entry with none. */
function trustPath(entry: unknown): string | null {
	if (typeof entry === 'string') return entry;
	if (entry && typeof entry === 'object') {
		const entryPath = (entry as {path?: unknown}).path;
		if (typeof entryPath === 'string') return entryPath;
	}
	return null;
}

/** Records saved before fingerprints were versioned are version 1. */
function isCurrentFingerprintVersion(entry: TrustedDirectoryRecord): boolean {
	return (entry.fingerprintVersion ?? 1) === TRUST_FINGERPRINT_VERSION;
}

/**
 * True if `directory` is recorded with a fingerprint that still matches
 * what the folder will run. Shared by every trust-gated entry point —
 * the interactive TUI's `useDirectoryTrust`, `--plain`'s `runPlainShell`,
 * and the daemon boot path — so the resolution rule can't drift between them.
 */
export function isDirectoryTrusted(
	directory: string,
	preferences: UserPreferences,
): boolean {
	const resolved = path.resolve(directory); // nosemgrep
	const fingerprint = describeProjectTrust(resolved).fingerprint;
	return (preferences.trustedDirectories ?? []).some(entry => {
		const entryPath = trustPath(entry);
		return (
			typeof entry === 'object' &&
			entryPath !== null &&
			path.resolve(entryPath) === resolved && // nosemgrep
			isCurrentFingerprintVersion(entry) &&
			entry.fingerprint === fingerprint
		);
	});
}

/**
 * Why a folder with a trust entry is asked again: its fingerprint changed,
 * or the entry can't be compared (a bare path saved before fingerprints
 * existed, or a fingerprint from another version).
 */
export type TrustRecheck = 'changed' | 'upgrade';

/** Null when `directory` has no trust entry at all. */
export function trustRecheck(
	directory: string,
	preferences: UserPreferences,
): TrustRecheck | null {
	const resolved = path.resolve(directory); // nosemgrep
	let recheck: TrustRecheck | null = null;
	for (const entry of preferences.trustedDirectories ?? []) {
		const entryPath = trustPath(entry);
		if (entryPath === null || path.resolve(entryPath) !== resolved) continue; // nosemgrep
		if (typeof entry !== 'string') {
			return isCurrentFingerprintVersion(entry) ? 'changed' : 'upgrade';
		}
		recheck = 'upgrade';
	}
	return recheck;
}

/** Shared wording for "Directory X ..." and "This folder ...". */
export function untrustedReason(recheck: TrustRecheck | null | undefined) {
	if (recheck === 'changed') return 'changed since you trusted it';
	if (recheck === 'upgrade') return 'needs re-approval after the upgrade';
	return 'is not trusted';
}

/**
 * Refusal for non-interactive entry points (`--plain`, `verify`). The two
 * bypasses last different lengths of time - the flag covers one run, the
 * variable saves the directory to `trustedDirectories` - so the message
 * names which is which. Shared by the text and `--json` outputs.
 */
export function untrustedDirectoryMessage(
	cwd: string,
	recheck?: TrustRecheck | null,
): string {
	return (
		`Directory ${cwd} ${untrustedReason(recheck)}` +
		`. Pass --trust-directory to bypass the ` +
		`disclaimer for this run only, or set NANOCODER_TRUST_DIRECTORY=1 to ` +
		`trust this directory permanently.`
	);
}

/**
 * Record this folder, including a fingerprint of what it will run. The
 * prompt passes the fingerprint it showed, so a file that lands while it
 * is open is asked about on the next start instead of trusted unseen.
 */
export function grantDirectoryTrust(
	preferences: UserPreferences,
	directory: string,
	fingerprint = describeProjectTrust(directory).fingerprint,
): UserPreferences {
	const resolved = path.resolve(directory); // nosemgrep
	const trustedDirectories = (preferences.trustedDirectories ?? []).filter(
		entry => {
			const entryPath = trustPath(entry);
			return entryPath === null || path.resolve(entryPath) !== resolved; // nosemgrep
		},
	);
	trustedDirectories.push({
		path: resolved,
		fingerprint,
		fingerprintVersion: TRUST_FINGERPRINT_VERSION,
	});
	return {...preferences, trustedDirectories};
}

export interface DirectoryTrustResult {
	trusted: boolean;
	/**
	 * True if this call persisted a new trust entry (env-var bypass only).
	 * Stays false when the write failed, so callers never announce a trust
	 * the next boot would not see.
	 */
	persisted: boolean;
	/**
	 * True when the env-var bypass granted trust for this run but the write
	 * did not land. `persisted === false` alone cannot say this: the one-shot
	 * `bypass` argument and an already-recorded directory both leave it false
	 * without anything having gone wrong. Callers warn on this flag so a
	 * failed write is not silent.
	 */
	persistFailed?: boolean;
	/** Set when refusing a folder that has a trust entry. */
	recheck?: TrustRecheck | null;
}

export interface DirectoryTrustDeps {
	loadPreferences: typeof loadPreferences;
	/** Savers may report failure (`false`); anything else counts as written. */
	savePreferences: (preferences: UserPreferences) => boolean | void;
}

/**
 * Resolves directory trust for a non-interactive entry point (`--plain`,
 * `nanocoder daemon start`) — anywhere that has no disclaimer UI to show.
 *
 * `bypass` is the caller's own one-shot override (each entry point's own
 * `--trust-directory` flag); it never persists, matching the interactive
 * disclaimer's per-run nature. A directory is trusted only when its saved
 * fingerprint still matches what the folder will run (see
 * `describeProjectTrust`). A path with no fingerprint, or an old
 * fingerprint, is not trusted, and `recheck` says which so the caller can
 * word it. `NANOCODER_TRUST_DIRECTORY=1` records the current fingerprint.
 */
export function ensureDirectoryTrust(
	directory: string,
	bypass: boolean,
	deps: DirectoryTrustDeps = {loadPreferences, savePreferences},
): DirectoryTrustResult {
	if (bypass) return {trusted: true, persisted: false};

	const preferences = deps.loadPreferences();
	if (isDirectoryTrusted(directory, preferences)) {
		return {trusted: true, persisted: false};
	}

	if (process.env.NANOCODER_TRUST_DIRECTORY === '1') {
		// `savePreferences` swallows write errors and reports them as `false`.
		// Propagate that instead of unconditionally claiming a persisted trust:
		// the callers print "Marked ... as trusted" on `persisted`, and on a
		// failed write the daemon's own gate would then refuse a directory the
		// user was just told was trusted. Savers that report nothing (test
		// doubles, older injections) keep the previous behaviour.
		const saved = deps.savePreferences(
			grantDirectoryTrust(preferences, directory),
		);
		const persisted = saved !== false;
		return {trusted: true, persisted, persistFailed: !persisted};
	}

	return {
		trusted: false,
		persisted: false,
		recheck: trustRecheck(directory, preferences),
	};
}

/**
 * `ensureDirectoryTrust` for entry points that just refuse: the message to
 * print when `directory` is not trusted, or null when it is.
 */
export function directoryTrustRefusal(
	directory: string,
	bypass: boolean,
	deps?: DirectoryTrustDeps,
): string | null {
	const trust = ensureDirectoryTrust(directory, bypass, deps);
	return trust.trusted
		? null
		: untrustedDirectoryMessage(path.resolve(directory), trust.recheck); // nosemgrep
}

/**
 * Persisted confirmation for the one-time `--trust full-commit` security
 * warning. Mirrors `useDirectoryTrust.tsx`'s `trustedDirectories` shape and
 * comparison logic (a list of already-confirmed resolved paths, not a
 * single global flag — a user may run the daemon against several projects
 * with different trust postures), but has no React dependency: `daemon
 * start` runs in the plain CLI fast-path, which never mounts Ink.
 */

import path from 'node:path';
import {loadPreferences, savePreferences} from '@/config/preferences';

// Windows filesystems are case-insensitive (NTFS preserves case but doesn't
// distinguish it), so a resolved path can be re-encountered with different
// casing (a different shell, a case-differing junction) and must still
// match. path.resolve() alone doesn't normalize this.
function normalize(projectRoot: string): string {
	const resolved = path.resolve(projectRoot); // nosemgrep
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function isFullCommitTrustConfirmed(projectRoot: string): boolean {
	const preferences = loadPreferences();
	const confirmed = preferences.fullCommitConfirmedProjects ?? [];
	const normalizedRoot = normalize(projectRoot);
	return confirmed.some(p => normalize(p) === normalizedRoot);
}

export function recordFullCommitTrustConfirmed(projectRoot: string): void {
	const preferences = loadPreferences();
	const confirmed = preferences.fullCommitConfirmedProjects ?? [];
	const normalizedRoot = normalize(projectRoot);
	if (!confirmed.some(p => normalize(p) === normalizedRoot)) {
		confirmed.push(path.resolve(projectRoot)); // nosemgrep
		preferences.fullCommitConfirmedProjects = confirmed;
		savePreferences(preferences);
	}
}

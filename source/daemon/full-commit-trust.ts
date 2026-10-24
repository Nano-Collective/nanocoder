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
import {normalizeForCompare} from '@/utils/path-validation';

export function isFullCommitTrustConfirmed(projectRoot: string): boolean {
	const preferences = loadPreferences();
	const confirmed = preferences.fullCommitConfirmedProjects ?? [];
	const normalizedRoot = normalizeForCompare(projectRoot);
	return confirmed.some(p => normalizeForCompare(p) === normalizedRoot);
}

export function recordFullCommitTrustConfirmed(projectRoot: string): void {
	const preferences = loadPreferences();
	const confirmed = preferences.fullCommitConfirmedProjects ?? [];
	const normalizedRoot = normalizeForCompare(projectRoot);
	if (!confirmed.some(p => normalizeForCompare(p) === normalizedRoot)) {
		confirmed.push(path.resolve(projectRoot)); // nosemgrep
		preferences.fullCommitConfirmedProjects = confirmed;
		savePreferences(preferences);
	}
}

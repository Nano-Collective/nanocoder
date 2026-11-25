/**
 * The `owner/repo` slug of a GitHub git remote, or null when the remote is
 * not a GitHub repository. Accepts the forms `git remote get-url` prints:
 *
 * - scp-style: `git@github.com:owner/repo.git` (any user, or none)
 * - URLs: `https://`, `http://`, `ssh://` and `git://`, on `github.com` or
 *   `www.github.com`, with or without `.git` and trailing slashes
 *
 * Owner and repo may only contain letters, digits, `_`, `.` and `-`, so the
 * slug is safe to pass to `gh --repo`.
 */
export function parseGitHubRepository(remote: string): string | null {
	const value = remote.trim();
	const scpMatch = value.match(
		/^(?:[^@/]+@)?github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i,
	);
	if (scpMatch) return scpMatch[1];

	try {
		const url = new URL(value);
		if (
			!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) ||
			(url.hostname !== 'github.com' && url.hostname !== 'www.github.com')
		) {
			return null;
		}

		const path = url.pathname.replace(/\/+$/, '').replace(/\.git$/i, '');
		const match = path.match(/^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/);
		return match?.[1] ?? null;
	} catch {
		return null;
	}
}

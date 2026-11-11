export type ReviewRequest =
	| {kind: 'default'}
	| {
			kind: 'branch';
			reference: string;
			selection: 'auto' | 'local' | 'remote';
	  }
	| {kind: 'pull-request'; number: string; repository?: string}
	| {kind: 'recent-commits'; count: number; branch?: string}
	| {kind: 'working-tree'};

export type ReviewRequestParseResult =
	| {ok: true; request: ReviewRequest}
	| {ok: false; error: string};

const REVIEW_REQUEST_USAGE =
	'Try `/review [branch <name> | PR number or URL | last N commits | working tree]`.';

const SMALL_NUMBERS: Record<string, number> = {
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
};

function parseCount(value: string): number | null {
	const count = /^\d+$/.test(value) ? Number(value) : SMALL_NUMBERS[value];
	return Number.isSafeInteger(count) && count >= 1 && count <= 100
		? count
		: null;
}

function parseRepositorySlug(value: string): string | null {
	return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
		? value.replace(/\.git$/i, '')
		: null;
}

function parsePullRequestUrl(value: string): {
	number: string;
	repository: string;
} | null {
	try {
		const url = new URL(value);
		if (
			url.protocol !== 'https:' ||
			!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase()) ||
			url.port ||
			url.username ||
			url.password
		) {
			return null;
		}
		const match = url.pathname.match(
			/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:\/[^/]*)?\/?$/,
		);
		if (!match) return null;
		const number = Number(match[3]);
		if (!Number.isSafeInteger(number) || number <= 0) return null;
		return {
			number: String(number),
			repository: `${match[1]}/${match[2].replace(/\.git$/i, '')}`,
		};
	} catch {
		return null;
	}
}

function normalizeInput(input: string): string {
	let value = input.trim();
	if (value.startsWith('/review')) {
		value = value.slice('/review'.length).trim();
	}
	return value.replace(/^["']|["']$/g, '').trim();
}

/**
 * Parse the deliberately small, deterministic review-request grammar.
 *
 * This function only classifies text. It never executes it, and branch values
 * remain untrusted until validated against repository refs by the resolver.
 */
export function parseReviewRequest(input: string): ReviewRequestParseResult {
	const value = normalizeInput(input);
	if (!value) return {ok: true, request: {kind: 'default'}};

	if (/^quick(?:\s|$)/i.test(value)) {
		return {
			ok: false,
			error:
				'Quick review remains the existing one-shot command; the review foundation does not resolve quick requests.',
		};
	}

	const pullRequestUrl = parsePullRequestUrl(value);
	if (pullRequestUrl) {
		return {
			ok: true,
			request: {kind: 'pull-request', ...pullRequestUrl},
		};
	}
	if (/^https?:\/\//i.test(value)) {
		return {
			ok: false,
			error:
				'Only a GitHub pull request URL is supported, for example https://github.com/owner/repo/pull/123.',
		};
	}

	const numberedPullRequest = value.match(
		/^(?:pr|pull request)\s*#?\s*(\d+)$/i,
	);
	const pullRequestNumber =
		numberedPullRequest?.[1] ?? (/^\d+$/.test(value) ? value : null);
	if (pullRequestNumber) {
		const number = Number(pullRequestNumber);
		if (!Number.isSafeInteger(number) || number <= 0) {
			return {
				ok: false,
				error: 'Pull request number must be a positive safe integer.',
			};
		}
		return {
			ok: true,
			request: {kind: 'pull-request', number: String(number)},
		};
	}

	if (
		/^(?:the\s+)?(?:working tree|worktree|uncommitted changes|local changes)$/i.test(
			value,
		)
	) {
		return {ok: true, request: {kind: 'working-tree'}};
	}

	const recentCommits = value.match(
		/^(?:the\s+)?last\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+commits?(?:\s+(?:on|in)\s+(?:this|the current|current)\s+branch)?$/i,
	);
	if (recentCommits) {
		const count = parseCount(recentCommits[1].toLowerCase());
		if (count === null) {
			return {
				ok: false,
				error: 'Review commit count must be between 1 and 100.',
			};
		}
		return {ok: true, request: {kind: 'recent-commits', count}};
	}

	const branchCommits = value.match(
		/^(?:the\s+)?last\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+commits?\s+on\s+branch\s+(.+)$/i,
	);
	if (branchCommits) {
		const count = parseCount(branchCommits[1].toLowerCase());
		const branch = branchCommits[2].trim();
		if (count === null) {
			return {
				ok: false,
				error: 'Review commit count must be between 1 and 100.',
			};
		}
		if (!branch) return {ok: false, error: REVIEW_REQUEST_USAGE};
		return {
			ok: true,
			request: {kind: 'recent-commits', count, branch},
		};
	}

	const explicitBranch = value.match(/^(?:(remote)\s+)?branch\s+(.+)$/i);
	if (explicitBranch) {
		const reference = explicitBranch[2].trim();
		if (!reference) return {ok: false, error: REVIEW_REQUEST_USAGE};
		return {
			ok: true,
			request: {
				kind: 'branch',
				reference,
				selection: explicitBranch[1] ? 'remote' : 'auto',
			},
		};
	}

	const localBranch = value.match(/^local:([^\s].*)$/i);
	if (localBranch) {
		return {
			ok: true,
			request: {
				kind: 'branch',
				reference: localBranch[1].trim(),
				selection: 'local',
			},
		};
	}

	const remoteBranch = value.match(/^remote:([^\s].*)$/i);
	if (remoteBranch) {
		return {
			ok: true,
			request: {
				kind: 'branch',
				reference: remoteBranch[1].trim(),
				selection: 'remote',
			},
		};
	}

	return {
		ok: false,
		error: `I could not resolve that review scope without guessing. ${REVIEW_REQUEST_USAGE}`,
	};
}

/**
 * Parse a repository slug from a GitHub remote without accepting other hosts.
 * Credentials embedded in HTTPS remotes (CI tokens, `insteadOf` rewrites) are
 * ignored; only the owner/repository slug is returned.
 */
export function parseGitHubRepository(value: string): string | null {
	const remote = value.trim();
	const scp = remote.match(
		/^(?:[^@/]+@)?github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i,
	);
	if (scp) return parseRepositorySlug(scp[1]);
	try {
		const url = new URL(remote);
		if (
			!['https:', 'ssh:', 'git:'].includes(url.protocol) ||
			!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase()) ||
			url.port
		) {
			return null;
		}
		const path = url.pathname.replace(/\/+$/, '').replace(/\.git$/i, '');
		const match = path.match(/^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/);
		return match ? parseRepositorySlug(match[1]) : null;
	} catch {
		return null;
	}
}

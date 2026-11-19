import test from 'ava';
import {
	parseGitHubRepository,
	parseReviewRequest,
} from './review-request';

test('request parser understands recent-commit and working-tree scopes', t => {
	t.deepEqual(parseReviewRequest('/review the last two commits on this branch'), {
		ok: true,
		request: {kind: 'recent-commits', count: 2},
	});
	t.deepEqual(
		parseReviewRequest('last 3 commits on branch feature/1287'),
		{
			ok: true,
			request: {
				kind: 'recent-commits',
				count: 3,
				branch: 'feature/1287',
			},
		},
	);
	t.deepEqual(parseReviewRequest('/review working tree'), {
		ok: true,
		request: {kind: 'working-tree'},
	});
});

test('request parser classifies branch selectors without executing their text', t => {
	t.deepEqual(parseReviewRequest('/review branch feature/foo'), {
		ok: true,
		request: {kind: 'branch', reference: 'feature/foo', selection: 'auto'},
	});
	t.deepEqual(parseReviewRequest('/review remote branch origin/feature/foo'), {
		ok: true,
		request: {
			kind: 'branch',
			reference: 'origin/feature/foo',
			selection: 'remote',
		},
	});
	t.deepEqual(parseReviewRequest('/review local:feature/foo'), {
		ok: true,
		request: {
			kind: 'branch',
			reference: 'feature/foo',
			selection: 'local',
		},
	});
	t.deepEqual(parseReviewRequest('/review branch feature; touch /tmp/pwned'), {
		ok: true,
		request: {
			kind: 'branch',
			reference: 'feature; touch /tmp/pwned',
			selection: 'auto',
		},
	});
});

test('request parser reads GitHub PR numbers and pasted pull-request URLs', t => {
	t.deepEqual(parseReviewRequest('PR #42'), {
		ok: true,
		request: {kind: 'pull-request', number: '42'},
	});
	t.deepEqual(
		parseReviewRequest('https://github.com/Nano-Collective/nanocoder/pull/1287/files'),
		{
			ok: true,
			request: {
				kind: 'pull-request',
				number: '1287',
				repository: 'Nano-Collective/nanocoder',
			},
		},
	);
	t.deepEqual(parseReviewRequest('https://github.com.evil.test/org/repo/pull/1'), {
		ok: false,
		error:
			'Only a GitHub pull request URL is supported, for example https://github.com/owner/repo/pull/123.',
	});
	t.deepEqual(parseReviewRequest('https://github.com/owner/repo/issues/1'), {
		ok: false,
		error:
			'Only a GitHub pull request URL is supported, for example https://github.com/owner/repo/pull/123.',
	});
});

test('request parser rejects guesses, invalid PR numbers, and quick-tier takeover', t => {
	t.false(parseReviewRequest('review both changes and tests').ok);
	t.false(parseReviewRequest('/review 9007199254740992').ok);
	t.false(parseReviewRequest('/review last 101 commits').ok);
	t.false(parseReviewRequest('/review quick branch').ok);
});

test('GitHub remote parsing handles fork URLs and rejects other hosts', t => {
	t.is(parseGitHubRepository('git@github.com:puri-adityakumar/nanocoder.git'), 'puri-adityakumar/nanocoder');
	t.is(parseGitHubRepository('https://github.com/Nano-Collective/nanocoder'), 'Nano-Collective/nanocoder');
	t.is(parseGitHubRepository('ssh://git@github.com/org/repo.git'), 'org/repo');
	t.is(parseGitHubRepository('https://github.com.attacker.test/org/repo'), null);
	t.is(parseGitHubRepository('https://github.com:8443/org/repo'), null);
});

test('GitHub remote parsing returns only the slug for credentialed HTTPS remotes', t => {
	t.is(parseGitHubRepository('https://user:password@github.com/org/repo'), 'org/repo');
	t.is(
		parseGitHubRepository('https://x-access-token:ghs_abc123@github.com/org/repo.git'),
		'org/repo',
	);
});

test('GitHub remote parsing accepts www hosts case-insensitively without trusting lookalikes', t => {
	t.is(parseGitHubRepository('https://www.github.com/acme/repo.git'), 'acme/repo');
	t.is(parseGitHubRepository('https://WWW.GITHUB.COM/acme/repo.git'), 'acme/repo');
	t.is(parseGitHubRepository('https://www.github.com.attacker.test/acme/repo.git'), null);
	t.is(parseGitHubRepository('https://www.github.com:8443/acme/repo.git'), null);
});

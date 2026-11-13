import test from 'ava';
import {parseGitHubRepository} from './github-repository';

console.log('\ngithub-repository.spec.ts');

const accepted: Array<[string, string]> = [
	// Forms both /review and /gh-pr-worktree already accepted.
	['git@github.com:owner/repo.git', 'owner/repo'],
	['git@github.com:owner/repo', 'owner/repo'],
	['git@github.com:owner/repo/', 'owner/repo'],
	['https://github.com/owner/repo.git', 'owner/repo'],
	['https://github.com/owner/repo', 'owner/repo'],
	['https://github.com/owner/repo/', 'owner/repo'],
	['ssh://git@github.com/owner/repo.git', 'owner/repo'],
	['  https://github.com/Nano-Collective/nano_coder.v2  \n', 'Nano-Collective/nano_coder.v2'],
	['GIT@GITHUB.COM:Owner/Repo.GIT', 'Owner/Repo'],
	// Accepted by /review only before; /gh-pr-worktree now accepts them too.
	['github.com:owner/repo.git', 'owner/repo'],
	['user@github.com:owner/repo.git', 'owner/repo'],
	['https://www.github.com/owner/repo', 'owner/repo'],
	['git://github.com/owner/repo.git', 'owner/repo'],
	['ssh://github.com/owner/repo.git', 'owner/repo'],
	['ssh://git@github.com:22/owner/repo.git', 'owner/repo'],
	['https://github.com/owner/repo.git//', 'owner/repo'],
	// Accepted by /gh-pr-worktree only before; /review now accepts it too.
	['http://github.com/owner/repo.git', 'owner/repo'],
];

for (const [remote, slug] of accepted) {
	test(`parses ${JSON.stringify(remote)}`, t => {
		t.is(parseGitHubRepository(remote), slug);
	});
}

const rejected = [
	'',
	'not a url',
	'https://gitlab.com/owner/repo.git',
	'git@gitlab.com:owner/repo.git',
	'https://github.com.evil.com/owner/repo',
	'https://github.com/owner',
	'https://github.com/owner/repo/tree/main',
	'https://github.com/owner/.git',
	'https://github.com/own er/repo',
	'git@github.com:owner/repo;rm -rf',
	'file:///github.com/owner/repo',
	'ftp://github.com/owner/repo',
	'/local/path/to/repo',
];

for (const remote of rejected) {
	test(`rejects ${JSON.stringify(remote)}`, t => {
		t.is(parseGitHubRepository(remote), null);
	});
}

import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {
	defaultReviewFoundationTools,
	type ReviewFoundationTools,
} from './review-tools';

export interface ReviewGitFixture {
	root: string;
	remote: string;
	runGit: (args: string[], env?: Record<string, string>) => string;
	runGitBuffer: (args: string[]) => Buffer;
	runRemoteGit: (args: string[]) => string;
	write: (path: string, content: string) => void;
	cleanup: () => void;
}

// Host Git config (URL rewrites, fsmonitor daemons, commit signing) changes
// remote URLs and can keep child pipes open, so fixtures ignore it.
const FIXTURE_GIT_ENV = {
	...process.env,
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_TERMINAL_PROMPT: '0',
};

export function createReviewGitFixture(): ReviewGitFixture {
	const directory = mkdtempSync(join(tmpdir(), 'nanocoder-review-foundation-'));
	const root = join(directory, 'worktree');
	const remote = join(directory, 'origin.git');
	execFileSync('git', ['init', '--initial-branch=main', root], {
		stdio: 'ignore',
		env: FIXTURE_GIT_ENV,
	});
	execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], {
		stdio: 'ignore',
		env: FIXTURE_GIT_ENV,
	});

	const runGit = (args: string[], env?: Record<string, string>) =>
		execFileSync('git', ['-C', root, ...args], {
			encoding: 'utf8',
			env: env ? {...FIXTURE_GIT_ENV, ...env} : FIXTURE_GIT_ENV,
		}).trimEnd();
	const runGitBuffer = (args: string[]) =>
		execFileSync('git', ['-C', root, ...args], {env: FIXTURE_GIT_ENV});
	const runRemoteGit = (args: string[]) =>
		execFileSync('git', ['--git-dir', remote, ...args], {
			encoding: 'utf8',
			env: FIXTURE_GIT_ENV,
		});
	const write = (path: string, content: string) => {
		const filePath = join(root, path);
		mkdirSync(dirname(filePath), {recursive: true});
		writeFileSync(filePath, content);
	};

	runGit(['config', 'user.name', 'Review Fixture']);
	runGit(['config', 'user.email', 'review-fixture@example.test']);
	const emptyHooks = join(root, '.empty-hooks');
	mkdirSync(emptyHooks);
	runGit(['config', 'core.hooksPath', emptyHooks]);
	write('src/file.ts', 'export const value = 1;\n');
	runGit(['add', '--', 'src/file.ts']);
	runGit(['commit', '-m', 'initial commit']);
	runGit(['remote', 'add', 'origin', remote]);
	runGit(['push', '--set-upstream', 'origin', 'main']);
	runGit(['remote', 'set-head', 'origin', 'main']);

	return {
		root,
		remote,
		runGit,
		runGitBuffer,
		runRemoteGit,
		write,
		cleanup: () => rmSync(directory, {recursive: true, force: true}),
	};
}

export function createReviewFixtureTools(
	fixture: ReviewGitFixture,
	options: {
		execGh?: (args: string[], signal?: AbortSignal) => Promise<string>;
		githubRepositories?: Record<string, string>;
	} = {},
): ReviewFoundationTools {
	return {
		...defaultReviewFoundationTools,
		execGit: async (args, signal, env) => {
			if (signal?.aborted) throw new Error('cancelled');
			return fixture.runGit(args, env);
		},
		execGitBuffer: async (args, signal) => {
			if (signal?.aborted) throw new Error('cancelled');
			return fixture.runGitBuffer(args);
		},
		execGh:
			options.execGh ??
			(async () => {
				throw new Error('gh was not expected in this fixture');
			}),
		githubRepositoryUrl: repository => {
			const remote = options.githubRepositories?.[repository.toLowerCase()];
			return remote
				? `file://${remote}`
				: `https://github.com/${repository}.git`;
		},
	};
}

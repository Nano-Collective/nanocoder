import test from 'ava';
import React from 'react';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import type {Message} from '@/types/core';
import {createReviewCommand, type ReviewDependencies} from './review';

const baseMessages: Message[] = [
	{role: 'user', content: '/review feature'},
];

const testMetadata = {
	provider: 'test-provider',
	model: 'test-model',
	tokens: 0,
	getMessageTokens: (m: Message) => m.content.length,
};

function createClient(response: string) {
	return {
		chat: async () => ({
			choices: [
				{
					message: {
						content: response,
					},
				},
			],
		}),
	};
}

function createGitHubFixture(options: {
	remoteUrls?: Record<string, string>;
	parents?: Record<string, string>;
	pullRequests?: Record<string, string[]>;
	pullRequestErrors?: Record<string, string>;
} = {}) {
	const remoteUrls = options.remoteUrls ?? {
		origin: 'git@github.com:user/repo.git',
	};
	const parents = options.parents ?? {};
	const pullRequests = options.pullRequests ?? {};
	const pullRequestErrors = options.pullRequestErrors ?? {};
	const gitCalls: string[][] = [];
	const ghCalls: string[][] = [];
	const dependencies: ReviewDependencies = {
		execGit: async args => {
			gitCalls.push(args);
			if (args[0] === 'remote' && args.length === 1) {
				return Object.keys(remoteUrls).join('\n');
			}
			if (args[0] === 'remote' && args[1] === 'get-url') {
				const name = args[3] ?? args[2] ?? '';
				const url = remoteUrls[name];
				if (!url) throw new Error(`unknown remote: ${name}`);
				return url;
			}
			if (args[0] === 'rev-parse') return '';
			if (args[0] === 'diff') return 'diff --git a/file.ts b/file.ts\n+const x = 1;';
			throw new Error(`unexpected git command: ${args.join(' ')}`);
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
		isGhAvailable: () => true,
		execGh: async args => {
			ghCalls.push(args);
			if (args[0] === 'api') {
				const path = args[1]?.replace(/^repos\//, '') ?? '';
				const requestError = pullRequestErrors[path];
				if (requestError) throw new Error(requestError);

				const pullRequestMatch = path.match(
					/^([^/]+\/[^/]+)\/pulls\/(\d+)$/,
				);
				if (pullRequestMatch) {
					const [, repository, number] = pullRequestMatch;
					const exists = pullRequests[repository.toLowerCase()]?.includes(number);
					if (!exists) throw new Error('HTTP 404: Not Found');
					return JSON.stringify({
						html_url: `https://github.com/${repository}/pull/${number}`,
					});
				}

				const repository = path.toLowerCase();
				const parent = parents[repository];
				return JSON.stringify({
					full_name: path,
					parent: parent ? {full_name: parent} : null,
				});
			}
			if (args[0] === 'pr' && args[1] === 'diff') {
				return 'diff --git a/pr-file.ts b/pr-file.ts\n+const y = 2;';
			}
			throw new Error(`unexpected gh command: ${args.join(' ')}`);
		},
	};

	return {dependencies, gitCalls, ghCalls};
}

test('reviewCommand has correct name and description', t => {
	const command = createReviewCommand({
		execGit: async () => '',
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
	});

	t.is(command.name, 'review');
	t.regex(
		command.description,
		/Review a branch or PR diff for bugs, security issues, and style violations/,
	);
});

test('review with no args reviews current branch (no usage error)', async t => {
	let diffArgs: string[] = [];

	const command = createReviewCommand({
		execGit: async args => {
			if (args[0] === 'rev-parse') return '';
			diffArgs = args;
			return 'diff --git a/file.ts b/file.ts\n+const x = 1;';
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
	});

	const result = await command.handler([], baseMessages, {
		...testMetadata,
		client: createClient('Looks good.'),
	});

	t.truthy(React.isValidElement(result));
	t.deepEqual(diffArgs, [
		'diff',
		'--no-ext-diff',
		'--no-color',
		'main...feature',
	]);
});

test('review returns an error when no client is available', async t => {
	const command = createReviewCommand({
		execGit: async () => '',
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
	});

	const result = await command.handler(['feature'], baseMessages, {
		...testMetadata,
		client: undefined,
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('No active LLM client available'));
});

test('review generates a review from the branch diff', async t => {
	let receivedMessages: Message[] = [];

	const command = createReviewCommand({
		execGit: async args => {
			if (args[0] === 'rev-parse') return '';
			return 'diff --git a/file.ts b/file.ts\n+const x = 1;';
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
	});

	const client = {
		chat: async (messages: Message[]) => {
			receivedMessages = messages;
			return {
				choices: [
					{
						message: {
							content:
								'## Review\n\n**Critical**: Potential null reference at line 5.',
						},
					},
				],
			};
		},
	};

	const result = await command.handler(['feature'], baseMessages, {
		...testMetadata,
		client,
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Potential null reference'));
	t.is(receivedMessages[0]?.role, 'system');
	t.is(receivedMessages[1]?.role, 'user');
	t.true(
		(receivedMessages[1]?.content as string).includes(
			'branch "feature" against "main"',
		),
	);
});

test('review warns when diff is empty', async t => {
	const command = createReviewCommand({
		execGit: async args => {
			if (args[0] === 'rev-parse') return '';
			return '';
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
	});

	const result = await command.handler(['feature'], baseMessages, {
		...testMetadata,
		client: createClient('should not be called'),
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('No changes found'));
});

test('review warns when the model returns an empty response', async t => {
	const command = createReviewCommand({
		execGit: async args => {
			if (args[0] === 'rev-parse') return '';
			return 'diff --git a/file.ts b/file.ts\n+const x = 1;';
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
	});

	const result = await command.handler(['feature'], baseMessages, {
		...testMetadata,
		client: createClient(''),
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Model returned an empty review'));
});

test('review returns an error when the LLM request fails', async t => {
	const command = createReviewCommand({
		execGit: async args => {
			if (args[0] === 'rev-parse') return '';
			return 'diff --git a/file.ts b/file.ts\n+const x = 1;';
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
	});

	const client = {
		chat: async () => {
			throw new Error('LLM request failed');
		},
	};

	const result = await command.handler(['feature'], baseMessages, {
		...testMetadata,
		client,
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('LLM request failed'));
});

test('review returns an error when git fails', async t => {
	const command = createReviewCommand({
		execGit: async () => {
			throw new Error('not a git repository');
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
	});

	const result = await command.handler(['feature'], baseMessages, {
		...testMetadata,
		client: createClient('should not be called'),
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('not a git repository'));
});

test('review uses the review system prompt', async t => {
	let systemPrompt = '';

	const command = createReviewCommand({
		execGit: async args => {
			if (args[0] === 'rev-parse') return '';
			return 'diff --git a/file.ts b/file.ts\n+const x = 1;';
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
	});

	const client = {
		chat: async (messages: Message[]) => {
			systemPrompt = (messages[0]?.content as string) || '';
			return {
				choices: [
					{
						message: {
							content: 'No issues found.',
						},
					},
				],
			};
		},
	};

	await command.handler(['feature'], baseMessages, {
		...testMetadata,
		client,
	});

	t.true(systemPrompt.includes('architect-level code review'));
	t.true(systemPrompt.includes('Correctness bugs'));
	t.true(systemPrompt.includes('Security vulnerabilities'));
});

test('quick review resolves a bare PR number to the unique upstream parent', async t => {
	const {dependencies, ghCalls} = createGitHubFixture({
		remoteUrls: {
			origin: 'git@github.com:puri-adityakumar/nanocoder.git',
		},
		parents: {
			'puri-adityakumar/nanocoder': 'Nano-Collective/nanocoder',
		},
		pullRequests: {
			'nano-collective/nanocoder': ['42'],
		},
	});
	let chatCalls = 0;
	let receivedMessages: Message[] = [];
	const client = {
		chat: async (
			messages: Message[],
			requestOptions?: unknown,
			providerOptions?: unknown,
		) => {
			chatCalls += 1;
			receivedMessages = messages;
			t.deepEqual(requestOptions, {});
			t.deepEqual(providerOptions, {});
			return {
				choices: [{message: {content: 'PR review looks good.'}}],
			};
		},
	};
	const command = createReviewCommand(dependencies);

	const result = await command.handler(['quick', '42'], baseMessages, {
		...testMetadata,
		client,
	});

	t.truthy(React.isValidElement(result));
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('PR review looks good.'));
	t.true(output.includes('Review scope: PR #42 in Nano-Collective/nanocoder.'));
	t.is(chatCalls, 1, 'quick review makes exactly one model call');
	t.is(receivedMessages.length, 2);
	t.deepEqual(receivedMessages.map(message => message.role), ['system', 'user']);
	t.deepEqual(ghCalls.at(-1), [
		'pr',
		'diff',
		'42',
		'--repo',
		'Nano-Collective/nanocoder',
	]);
});

test('bare PR number fails clearly when fork and upstream numbers collide', async t => {
	const {dependencies, ghCalls} = createGitHubFixture({
		remoteUrls: {
			origin: 'https://github.com/puri-adityakumar/nanocoder',
			upstream: 'ssh://git@github.com/Nano-Collective/nanocoder.git',
		},
		parents: {
			'puri-adityakumar/nanocoder': 'Nano-Collective/nanocoder',
		},
		pullRequests: {
			'puri-adityakumar/nanocoder': ['42'],
			'nano-collective/nanocoder': ['42'],
		},
	});
	let chatCalls = 0;
	const command = createReviewCommand(dependencies);

	const result = await command.handler(['quick', '42'], baseMessages, {
		...testMetadata,
		client: {
			chat: async () => {
				chatCalls += 1;
				return {choices: [{message: {content: 'should not run'}}]};
			},
		},
	});

	t.truthy(React.isValidElement(result));
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(
		/exists in multiple configured GitHub\s+repositories/.test(output),
		output,
	);
	t.true(output.includes('full GitHub PR URL'));
	t.false(ghCalls.some(args => args[0] === 'pr' && args[1] === 'diff'));
	t.is(chatCalls, 0);
});

test('explicit GitHub PR URL uses its owner and repository directly', async t => {
	const {dependencies, ghCalls, gitCalls} = createGitHubFixture();
	const command = createReviewCommand(dependencies);

	const result = await command.handler(
		['https://github.com/other-owner/other-repo/pull/42?tab=files'],
		baseMessages,
		{...testMetadata, client: createClient('Explicit URL review.')},
	);

	t.truthy(React.isValidElement(result));
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(
		output.includes('Review scope: PR #42 in other-owner/other-repo.'),
	);
	t.deepEqual(ghCalls, [
		['pr', 'diff', '42', '--repo', 'other-owner/other-repo'],
	]);
	t.deepEqual(gitCalls, []);
});

test('review returns error for PR number when gh is unavailable', async t => {
	const command = createReviewCommand({
		execGit: async () => '',
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
		isGhAvailable: () => false,
	});

	const result = await command.handler(['42'], baseMessages, {
		...testMetadata,
		client: createClient('should not be called'),
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('PR review requires the gh CLI'));
});

test('review rejects extra target arguments and non-PR GitHub URLs', async t => {
	let gitCalls = 0;
	const command = createReviewCommand({
		execGit: async () => {
			gitCalls += 1;
			return '';
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
	});

	for (const {args, expected} of [
		{args: ['quick', '42', 'extra'], expected: 'Usage: /review'},
		{args: ['feature', 'main'], expected: 'Usage: /review'},
		{
			args: ['https://github.com/owner/repo/issues/42'],
			expected: 'Target URL must be a GitHub pull request URL',
		},
	]) {
		const result = await command.handler(args, baseMessages, {
			...testMetadata,
			client: createClient('should not be called'),
		});

		t.truthy(React.isValidElement(result));
		const {lastFrame} = renderWithTheme(result as React.ReactElement);
		const output = lastFrame() || '';
		t.true(output.includes(expected));
	}

	t.is(gitCalls, 0, 'invalid targets are rejected before GitHub or git access');
});

test('review returns error when GitHub cannot safely resolve a bare PR number', async t => {
	const {dependencies} = createGitHubFixture({
		pullRequestErrors: {
			'user/repo/pulls/42': 'HTTP 403: Resource not accessible',
		},
	});
	const command = createReviewCommand(dependencies);

	const result = await command.handler(['42'], baseMessages, {
		...testMetadata,
		client: createClient('should not be called'),
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Failed to fetch PR #42 diff'));
	t.true(output.includes('Pass a full GitHub PR URL'));
});

test('review returns error for PR number with no GitHub remotes', async t => {
	const {dependencies} = createGitHubFixture({
		remoteUrls: {origin: 'git@gitlab.com:user/repo.git'},
	});
	const command = createReviewCommand(dependencies);

	const result = await command.handler(['42'], baseMessages, {
		...testMetadata,
		client: createClient('should not be called'),
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Cannot determine a GitHub repository'));
	t.true(output.includes('full GitHub PR URL'));
});

test('review rejects target starting with dash', async t => {
	const command = createReviewCommand({
		execGit: async () => '',
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
	});

	const result = await command.handler(['--ext-diff'], baseMessages, {
		...testMetadata,
		client: createClient('should not be called'),
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('must not start with "-"'));
});

test('review with no args reviews current branch against default', async t => {
	let diffArgs: string[] = [];

	const command = createReviewCommand({
		execGit: async args => {
			if (args[0] === 'rev-parse') return '';
			diffArgs = args;
			return 'diff --git a/file.ts b/file.ts\n+const x = 1;';
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
	});

	const result = await command.handler([], baseMessages, {
		...testMetadata,
		client: createClient('Looks good.'),
	});

	t.truthy(React.isValidElement(result));
	t.deepEqual(diffArgs, [
		'diff',
		'--no-ext-diff',
		'--no-color',
		'main...feature',
	]);
});

test('review with default branch as target reviews current branch against it', async t => {
	let diffArgs: string[] = [];

	const command = createReviewCommand({
		execGit: async args => {
			if (args[0] === 'rev-parse') return '';
			diffArgs = args;
			return 'diff --git a/file.ts b/file.ts\n+const x = 1;';
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
	});

	const result = await command.handler(['main'], baseMessages, {
		...testMetadata,
		client: createClient('Looks good.'),
	});

	t.truthy(React.isValidElement(result));
	t.deepEqual(diffArgs, [
		'diff',
		'--no-ext-diff',
		'--no-color',
		'main...feature',
	]);
});

test('review surfaces truncation info when diff exceeds limit', async t => {
	const bigDiff = Array.from({length: 1100}, (_, i) => `+line ${i}`).join(
		'\n',
	);

	let userMessage = '';

	const command = createReviewCommand({
		execGit: async args => {
			if (args[0] === 'rev-parse') return '';
			return bigDiff;
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
	});

	const client = {
		chat: async (messages: Message[]) => {
			userMessage = (messages[1]?.content as string) || '';
			return {
				choices: [
					{
						message: {
							content: 'Looks good.',
						},
					},
				],
			};
		},
	};

	const result = await command.handler(['feature'], baseMessages, {
		...testMetadata,
		client,
	});

	t.truthy(React.isValidElement(result));
	t.true(userMessage.includes('Partial diff coverage'));
	t.true(userMessage.includes('first 500 and last 500 of 1100 diff lines'));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';
	t.true(output.includes('Review scope: branch "feature" against "main".'));
	t.true(output.includes('Partial diff coverage'));
	t.true(output.includes('100 intervening lines were omitted and were not reviewed.'));
});

test('review uses fallback prompt when loadPrompt returns fallback', async t => {
	const fallbackPrompt =
		'You are a senior software engineer performing a code review. Review the diff for bugs, security issues, and style violations. Be concise and actionable.';

	let systemPrompt = '';

	const client = {
		chat: async (messages: Message[]) => {
			systemPrompt = (messages[0]?.content as string) || '';
			return {
				choices: [
					{
						message: {
							content: 'Looks good.',
						},
					},
				],
			};
		},
	};

	const command = createReviewCommand({
		execGit: async args => {
			if (args[0] === 'rev-parse') return '';
			return 'diff --git a/file.ts b/file.ts\n+const x = 1;';
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
		isGhAvailable: () => false,
		execGh: undefined,
		loadPrompt: () => fallbackPrompt,
	});

	const result = await command.handler(['feature'], baseMessages, {
		...testMetadata,
		client,
	});

	t.truthy(React.isValidElement(result));
	t.is(systemPrompt, fallbackPrompt);
});

import test from 'ava';
import React from 'react';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import type {Message} from '@/types/core';
import {createReviewCommand} from './review';

const baseMessages: Message[] = [
	{role: 'user', content: '/review main'},
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

test('review shows usage when no args provided', async t => {
	const command = createReviewCommand({
		execGit: async () => '',
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
	});

	const result = await command.handler([], baseMessages, testMetadata);

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Usage: /review <branch-or-pr-number>'));
	t.true(output.includes('/review main'));
});

test('review returns an error when no client is available', async t => {
	const command = createReviewCommand({
		execGit: async () => '',
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
	});

	const result = await command.handler(['main'], baseMessages, {
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
			// rev-parse to verify branch exists
			if (args[0] === 'rev-parse') return '';
			// diff command
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
		(receivedMessages[1]?.content as string).includes('branch "feature"'),
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

test('review handles PR number target with gh available', async t => {
	let executedGhArgs: string[][] = [];

	const command = createReviewCommand({
		execGit: async args => {
			if (args[0] === 'rev-parse') return '';
			if (args[0] === 'remote') return 'git@github.com:user/repo.git';
			return 'diff --git a/file.ts b/file.ts\n+const x = 1;';
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
		isGhAvailable: () => true,
		execGh: async args => {
			executedGhArgs.push(args);
			return 'diff --git a/pr-file.ts b/pr-file.ts\n+const y = 2;';
		},
	});

	const result = await command.handler(['42'], baseMessages, {
		...testMetadata,
		client: createClient('PR review looks good.'),
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('PR review looks good.'));
	// Should have called gh pr diff with the PR number and repo slug
	t.deepEqual(executedGhArgs, [['pr', 'diff', '42', '--repo', 'user/repo']]);
});

test('review handles PR number target with gh unavailable', async t => {
	let executedGitArgs: string[][] = [];

	const command = createReviewCommand({
		execGit: async args => {
			executedGitArgs.push(args);
			if (args[0] === 'rev-parse') return '';
			return 'diff --git a/file.ts b/file.ts\n+const x = 1;';
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
		isGhAvailable: () => false,
		execGh: async () => {
			throw new Error('gh not available');
		},
	});

	const result = await command.handler(['42'], baseMessages, {
		...testMetadata,
		client: createClient('Branch fallback review.'),
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Branch fallback review.'));
	// Should have fallen back to branch diff
	t.true(
		executedGitArgs.some(
			args => args[0] === 'diff' && args.includes('main...42'),
		),
	);
});

test('review handles PR number target when gh fails', async t => {
	let executedGitArgs: string[][] = [];

	const command = createReviewCommand({
		execGit: async args => {
			executedGitArgs.push(args);
			if (args[0] === 'rev-parse') return '';
			if (args[0] === 'remote') return 'git@github.com:user/repo.git';
			return 'diff --git a/file.ts b/file.ts\n+const x = 1;';
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
		isGhAvailable: () => true,
		execGh: async () => {
			throw new Error('gh pr diff failed');
		},
	});

	const result = await command.handler(['42'], baseMessages, {
		...testMetadata,
		client: createClient('Fallback after gh failure.'),
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Fallback after gh failure.'));
	// Should have fallen back to branch diff after gh failure
	t.true(
		executedGitArgs.some(
			args => args[0] === 'diff' && args.includes('main...42'),
		),
	);
});

test('review handles PR number with non-GitHub remote URL', async t => {
	let executedGitArgs: string[][] = [];

	const command = createReviewCommand({
		execGit: async args => {
			executedGitArgs.push(args);
			if (args[0] === 'rev-parse') return '';
			if (args[0] === 'remote') return 'git@gitlab.com:user/repo.git';
			return 'diff --git a/file.ts b/file.ts\n+const x = 1;';
		},
		getCurrentBranch: async () => 'feature',
		getDefaultBranch: async () => 'main',
		isGhAvailable: () => true,
		execGh: async () => 'diff from gh',
	});

	const result = await command.handler(['42'], baseMessages, {
		...testMetadata,
		client: createClient('Fallback for non-GitHub.'),
	});

	t.truthy(React.isValidElement(result));

	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	const output = lastFrame() || '';

	t.true(output.includes('Fallback for non-GitHub.'));
	t.true(
		executedGitArgs.some(
			args => args[0] === 'diff' && args.includes('main...42'),
		),
	);
});

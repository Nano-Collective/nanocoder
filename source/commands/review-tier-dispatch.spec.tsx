import test from 'ava';
import React from 'react';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import {setProjectRoot} from '@/services/session-cwd';
import type {Message} from '@/types/core';
import {createReviewCommand} from './review';
import {REVIEW_FINDER_AGENT} from '@/review/review-agents.js';
import {REVIEW_VERIFIER_AGENT} from '@/review/review-agents.js';

console.log('\nreview-tier-dispatch.spec.ts');

// Citation validation resolves findings against the project root, so the
// agentic dispatch tests point it at a temp project containing sample.ts.
const projectRoot = mkdtempSync(join(tmpdir(), 'nc-review-dispatch-'));
writeFileSync(join(projectRoot, 'sample.ts'), 'context\nadded line\nmore\n');
setProjectRoot(projectRoot);

const baseMessages: Message[] = [{role: 'user', content: '/review'}];

const testMetadata = {
	provider: 'test-provider',
	model: 'test-model',
	tokens: 0,
	getMessageTokens: (m: Message) => m.content.length,
};

const GOOD_DIFF =
	'diff --git a/sample.ts b/sample.ts\n--- a/sample.ts\n+++ b/sample.ts\n@@ -1,2 +1,3 @@\n context\n+added line\n more context\n';

const baseDeps = {
	execGit: async (args: string[]) => {
		if (args[0] === 'rev-parse') return '';
		return GOOD_DIFF;
	},
	getCurrentBranch: async () => 'feature',
	getDefaultBranch: async () => 'main',
};

const FINDER_OUTPUT = [
	'FINDING',
	'FILE: sample.ts',
	'LINE: 2',
	'SEVERITY: high',
	'ISSUE: something real',
	'EVIDENCE: added line',
	'END',
].join('\n');

function scriptedExecutorDeps(verifyWith: (id: string) => string) {
	const calls: Array<{type: string; prompt: string}> = [];
	return {
		deps: {
			...baseDeps,
			getExecutor: () => ({
				execute: async (task: {
					subagent_type: string;
					prompt?: string;
				}) => {
					calls.push({type: task.subagent_type, prompt: task.prompt ?? ''});
					if (task.subagent_type === REVIEW_FINDER_AGENT) {
						return {
							subagentName: REVIEW_FINDER_AGENT,
							output: FINDER_OUTPUT,
							success: true,
							executionTimeMs: 1,
						};
					}
					const id = /ID: (F\d+)/.exec(task.prompt ?? '')?.[1] ?? 'F1';
					return {
						subagentName: REVIEW_VERIFIER_AGENT,
						output: verifyWith(id),
						success: true,
						executionTimeMs: 1,
					};
				},
			}),
		},
		calls,
	};
}

async function render(result: unknown): Promise<string> {
	const {lastFrame} = renderWithTheme(result as React.ReactElement);
	return lastFrame() || '';
}

test('default tier runs the agentic pipeline and renders the report', async t => {
	const {deps, calls} = scriptedExecutorDeps(
		id => `VERDICT: CONFIRM\nID: ${id}\nREASON: proven`,
	);
	const command = createReviewCommand(deps);

	const output = await render(
		await command.handler(['feature'], baseMessages, {
			...testMetadata,
			client: {chat: async () => ({})},
		}),
	);

	t.is(calls.filter(c => c.type === REVIEW_FINDER_AGENT).length, 1);
	t.is(calls.filter(c => c.type === REVIEW_VERIFIER_AGENT).length, 1);
	t.true(output.includes('Verified findings'));
	t.true(output.includes('sample.ts:2'));
	t.true(output.includes('something real'));
	t.true(output.includes('HIGH'));
});

test('deep tier runs the agentic pipeline too', async t => {
	const {calls} = scriptedExecutorDeps(
		id => `VERDICT: CONFIRM\nID: ${id}\nREASON: proven`,
	);
	const command = createReviewCommand({
		...baseDeps,
		getExecutor: () => ({
			execute: async (task: {subagent_type: string; prompt?: string}) => ({
				subagentName: task.subagent_type,
				output:
					task.subagent_type === REVIEW_FINDER_AGENT
						? FINDER_OUTPUT
						: `VERDICT: CONFIRM\nID: ${
								/ID: (F\d+)/.exec(task.prompt ?? '')?.[1] ?? 'F1'
							}\nREASON: proven`,
				success: true,
				executionTimeMs: 1,
			}),
		}),
	});
	void calls;

	const output = await render(
		await command.handler(['deep', 'feature'], baseMessages, {
			...testMetadata,
			client: {chat: async () => ({})},
		}),
	);

	t.true(output.includes('Verified findings'));
});

test('rejected findings are shown as dropped, never confirmed', async t => {
	const command = createReviewCommand(
		scriptedExecutorDeps(
			id => `VERDICT: REJECT\nID: ${id}\nREASON: guarded upstream`,
		).deps,
	);

	const output = await render(
		await command.handler(['feature'], baseMessages, {
			...testMetadata,
			client: {chat: async () => ({})},
		}),
	);

	t.true(output.includes('No verified issues found'));
	t.true(output.includes('Dropped findings'));
	t.true(output.includes('REJECT'));
	t.true(output.includes('guarded upstream'));
});

test('default tier without an executor falls back to one-shot with a note', async t => {
	let clientWasCalled = false;
	const command = createReviewCommand({
		...baseDeps,
		getExecutor: () => null,
	});

	const output = await render(
		await command.handler(['feature'], baseMessages, {
			...testMetadata,
			client: {
				chat: async () => ({
					choices: [{message: {content: 'One-shot review text.'}}],
				}),
			},
		}),
	);
	void clientWasCalled;

	t.true(output.includes('One-shot review text.'));
	t.true(
		output.includes('Ran as one-shot review'),
		'the fallback must be visible to the user',
	);
});

test('quick tier never touches the executor even when one exists', async t => {
	let executorWasUsed = false;
	const command = createReviewCommand({
		...baseDeps,
		getExecutor: () => {
			executorWasUsed = true;
			return {execute: async () => ({})};
		},
	});

	const output = await render(
		await command.handler(['quick', 'feature'], baseMessages, {
			...testMetadata,
			client: {
				chat: async () => ({
					choices: [{message: {content: 'Quick one-shot review.'}}],
				}),
			},
		}),
	);

	t.false(executorWasUsed, 'quick must stay one-shot');
	t.true(output.includes('Quick one-shot review.'));
	t.false(output.includes('Ran as one-shot review'), 'no fallback note');
});

test('quick tier warns on empty model response', async t => {
	const command = createReviewCommand({
		...baseDeps,
		getExecutor: () => null,
	});

	const output = await render(
		await command.handler(['quick', 'feature'], baseMessages, {
			...testMetadata,
			client: {chat: async () => ({choices: [{message: {content: ''}}]})},
		}),
	);

	t.true(output.includes('Model returned an empty review'));
});

test('agentic report surfaces approximate usage', async t => {
	const command = createReviewCommand({
		...baseDeps,
		getExecutor: () => ({
			execute: async (task: {subagent_type: string; prompt?: string}) => ({
				subagentName: task.subagent_type,
				output:
					task.subagent_type === REVIEW_FINDER_AGENT
						? FINDER_OUTPUT
						: `VERDICT: CONFIRM\nID: ${
								/ID: (F\d+)/.exec(task.prompt ?? '')?.[1] ?? 'F1'
							}\nREASON: proven`,
				success: true,
				tokensUsed: 42,
				executionTimeMs: 1,
			}),
		}),
	});

	const output = await render(
		await command.handler(['feature'], baseMessages, {
			...testMetadata,
			client: {chat: async () => ({})},
		}),
	);

	t.true(output.includes('Approximate token usage'));
	t.true(output.includes('finder 42'));
});

import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {setProjectRoot} from '@/services/session-cwd';
import {SubagentExecutor} from '@/subagents/subagent-executor.js';
import {getSubagentLoader} from '@/subagents/subagent-loader.js';
import {setGlobalToolApprovalHandler} from '@/utils/tool-approval-queue';
import type {ReviewFinding} from './finding-format.js';
import {
	REVIEW_FINDER_AGENT,
	REVIEW_READ_ONLY_TOOLS,
	REVIEW_VERIFIER_AGENT,
	registerReviewAgents,
} from './review-agents.js';
import {
	runDefaultReview,
	type ReviewSubagentExecutor,
} from './run-default-review.js';

console.log('\nrun-default-review.spec.ts');

const DIFF = [
	'diff --git a/sample.ts b/sample.ts',
	'--- a/sample.ts',
	'+++ b/sample.ts',
	'@@ -1,3 +1,4 @@',
	' export function readIt(path: string) {',
	'+  // changed line',
	'   return readFileSync(path);',
	' }',
].join('\n');

const FINDER_OUTPUT = [
	'FINDING',
	'FILE: sample.ts',
	'LINE: 2',
	'SEVERITY: high',
	'ISSUE: readFileSync is undefined in scope',
	'EVIDENCE: return readFileSync(path);',
	'END',
].join('\n');

function verdictFor(finding: ReviewFinding): string {
	return `VERDICT: CONFIRM\nID: ${finding.id}\nREASON: the code proves it`;
}

/** Executor double: scripted per-subagent responses with call recording. */
function scriptedExecutor(
	handlers: Array<(prompt: string) => string>,
	calls?: Array<{type: string; prompt: string; limits?: unknown}>,
): ReviewSubagentExecutor {
	let index = 0;
	return {
		execute: async task => {
			const handler = handlers[Math.min(index, handlers.length - 1)];
			index++;
			calls?.push({
				type: task.subagent_type,
				prompt: task.prompt ?? '',
				limits: (task as unknown as {_limits?: unknown})._limits,
			});
			const output = handler(task.prompt ?? '');
			return {
				subagentName: task.subagent_type,
				output,
				success: true,
				tokensUsed: 10 * index,
				executionTimeMs: 1,
			};
		},
	};
}

const findingOf = (output: string): ReviewFinding => {
	const block = output
		.split('\n')
		.filter(l => !['FINDING', 'END'].includes(l.trim()));
	const get = (key: string) =>
		block.find(l => l.startsWith(`${key}: `))?.slice(key.length + 2) ?? '';
	return {
		id: get('ID') || 'F1',
		file: get('FILE'),
		line: Number.parseInt(get('LINE'), 10),
		severity: get('SEVERITY') as ReviewFinding['severity'],
		issue: get('ISSUE'),
		evidence: get('EVIDENCE'),
	};
};

// ============================================================================
// Pipeline behaviour

test('pipeline - confirmed finding survives; rejected is dropped', async t => {
	const finding = findingOf(FINDER_OUTPUT);
	let verifierCalls = 0;
	const executor = scriptedExecutor([
		() => FINDER_OUTPUT,
		prompt => {
			verifierCalls++;
			const id = /ID: (F\d+)/.exec(prompt)?.[1];
			return `VERDICT: ${id === finding.id ? 'CONFIRM' : 'REJECT'}\nID: ${id}\nREASON: checked`;
		},
	]);

	const projectRoot = mkdtempSync(join(tmpdir(), 'nc-pipeline-'));
	writeFileSync(join(projectRoot, 'sample.ts'), 'a\nb\nc\n');

	const result = await runDefaultReview(executor, {
		diff: DIFF,
		targetDescription: 'main...feature',
		projectRoot,
	});

	t.is(verifierCalls, 1);
	t.is(result.confirmed.length, 1);
	t.is(result.confirmed[0].id, finding.id);
	t.is(result.usage.finder, 10);
	t.is(result.usage.verifier, 20);
});

test('pipeline - two findings on the same line get separate verifiers and verdicts', async t => {
	const second = FINDER_OUTPUT.replace(
		'ISSUE: readFileSync is undefined in scope',
		'ISSUE: missing null check',
	).replace('SEVERITY: high', 'SEVERITY: medium');
	const combined = `${FINDER_OUTPUT}\n${second}`;

	const verdictIds: string[] = [];
	const executor = scriptedExecutor([
		() => combined,
		prompt => {
			const id = /ID: (F\d+)/.exec(prompt)?.[1] ?? '';
			verdictIds.push(id);
			return id === 'F1'
				? `VERDICT: CONFIRM\nID: ${id}\nREASON: real`
				: `VERDICT: REJECT\nID: ${id}\nREASON: guarded`;
		},
	]);

	const projectRoot = mkdtempSync(join(tmpdir(), 'nc-pipeline-'));
	writeFileSync(join(projectRoot, 'sample.ts'), 'a\nb\nc\n');

	const result = await runDefaultReview(executor, {
		diff: DIFF,
		targetDescription: 'main...feature',
		projectRoot,
	});

	t.is(verdictIds.length, 2, 'each finding got its own verifier');
	t.is(result.confirmed.length, 1);
	t.is(result.confirmed[0].issue, 'readFileSync is undefined in scope');
	t.is(result.dropped.length, 1);
	t.is(result.dropped[0].verdict, 'REJECT');
});

test('pipeline - verifier never sees the finder transcript', async t => {
	const executor = scriptedExecutor([
		() => `internal musing about architecture\n${FINDER_OUTPUT}`,
		prompt => {
			t.false(
				prompt.includes('internal musing'),
				'verifier prompt must not carry finder conversation',
			);
			const id = /ID: (F\d+)/.exec(prompt)?.[1] ?? 'F1';
			return `VERDICT: CONFIRM\nID: ${id}\nREASON: ok`;
		},
	]);

	const projectRoot = mkdtempSync(join(tmpdir(), 'nc-pipeline-'));
	writeFileSync(join(projectRoot, 'sample.ts'), 'a\nb\nc\n');

	const result = await runDefaultReview(executor, {
		diff: DIFF,
		targetDescription: 'main...feature',
		projectRoot,
	});
	t.is(result.confirmed.length, 1);
});

test('pipeline - hallucinated citation is rejected before verification', async t => {
	const bogus = [
		'FINDING',
		'FILE: ghost/never-exists.ts',
		'LINE: 99',
		'SEVERITY: critical',
		'ISSUE: made up',
		'EVIDENCE: none',
		'END',
	].join('\n');
	let verifierCalls = 0;
	const executor = scriptedExecutor([
		() => bogus,
		() => {
			verifierCalls++;
			return 'should never run';
		},
	]);

	const projectRoot = mkdtempSync(join(tmpdir(), 'nc-pipeline-'));

	const result = await runDefaultReview(executor, {
		diff: DIFF,
		targetDescription: 'main...feature',
		projectRoot,
	});

	t.is(verifierCalls, 0, 'no verifier spent on a hallucinated citation');
	t.is(result.confirmed.length, 0);
	t.true(
		result.notes.some(n => n.includes('citation rejected')),
		`expected a citation note, got: ${result.notes.join(' | ')}`,
	);
});

test('pipeline - no findings means a clean report, not an error', async t => {
	const executor = scriptedExecutor([() => 'I reviewed the diff; all good.']);
	const projectRoot = mkdtempSync(join(tmpdir(), 'nc-pipeline-'));

	const result = await runDefaultReview(executor, {
		diff: DIFF,
		targetDescription: 'main...feature',
		projectRoot,
	});

	t.is(result.confirmed.length, 0);
	t.true(result.notes.includes('finder reported no issues'));
});

test('pipeline - failed finder still yields partial findings', async t => {
	const executor = scriptedExecutor([
		() => FINDER_OUTPUT,
		prompt => {
			const id = /ID: (F\d+)/.exec(prompt)?.[1] ?? 'F1';
			return `VERDICT: CONFIRM\nID: ${id}\nREASON: ok`;
		},
	]);
	// Override: finder fails after producing output.
	const failingThenParsing: ReviewSubagentExecutor = {
		execute: async task => {
			if (task.subagent_type === REVIEW_FINDER_AGENT) {
				return {
					subagentName: REVIEW_FINDER_AGENT,
					output: FINDER_OUTPUT,
					success: false,
					error: 'reached turn budget',
					executionTimeMs: 1,
				};
			}
			return {
				subagentName: REVIEW_VERIFIER_AGENT,
				output: `VERDICT: CONFIRM\nID: ${
					/ID: (F\d+)/.exec(task.prompt ?? '')?.[1] ?? 'F1'
				}\nREASON: ok`,
				success: true,
				executionTimeMs: 1,
			};
		},
	};

	const projectRoot = mkdtempSync(join(tmpdir(), 'nc-pipeline-'));
	writeFileSync(join(projectRoot, 'sample.ts'), 'a\nb\nc\n');

	const result = await runDefaultReview(failingThenParsing, {
		diff: DIFF,
		targetDescription: 'main...feature',
		projectRoot,
	});

	t.true(
		result.notes.some(n => n.includes('did not complete cleanly')),
	);
	t.is(result.confirmed.length, 1, 'partial findings are still processed');
	void executor;
});

test('pipeline - budgets and ceilings are enforced on every call', async t => {
	const seen: Array<{type: string; limits?: unknown}> = [];
	const base = scriptedExecutor([
		() => FINDER_OUTPUT,
		prompt => {
			const id = /ID: (F\d+)/.exec(prompt)?.[1] ?? 'F1';
			return `VERDICT: CONFIRM\nID: ${id}\nREASON: ok`;
		},
	]);
	const executor: ReviewSubagentExecutor = {
		execute: async (task, signal, depth, agentId, ctx, limits) => {
			seen.push({type: task.subagent_type, limits});
			return base.execute(task, signal, depth, agentId, ctx, limits);
		},
	};

	const projectRoot = mkdtempSync(join(tmpdir(), 'nc-pipeline-'));
	writeFileSync(join(projectRoot, 'sample.ts'), 'a\nb\nc\n');

	await runDefaultReview(executor, {
		diff: DIFF,
		targetDescription: 'main...feature',
		projectRoot,
		finderMaxToolCalls: 3,
		finderMaxTurns: 2,
		verifierMaxToolCalls: 1,
		verifierMaxTurns: 2,
	});

	const finder = seen.find(s => s.type === REVIEW_FINDER_AGENT);
	const verifier = seen.find(s => s.type === REVIEW_VERIFIER_AGENT);
	t.truthy(finder?.limits);
	t.truthy(verifier?.limits);
	const finderLimits = finder?.limits as {
		allowedTools: string[];
		maxToolCalls: number;
		maxTurns: number;
	};
	const verifierLimits = verifier?.limits as {
		allowedTools: string[];
		maxToolCalls: number;
		maxTurns: number;
	};
	t.deepEqual(finderLimits.allowedTools, [...REVIEW_READ_ONLY_TOOLS]);
	t.is(finderLimits.maxToolCalls, 3);
	t.is(finderLimits.maxTurns, 2);
	t.is(verifierLimits.maxToolCalls, 1);
	t.is(verifierLimits.maxTurns, 2);
	t.deepEqual(verifierLimits.allowedTools, [...REVIEW_READ_ONLY_TOOLS]);
});

test('pipeline - verification cap leaves extra findings unverified', async t => {
	const extra = [
		'FINDING',
		'FILE: sample.ts',
		'LINE: 3',
		'SEVERITY: low',
		'ISSUE: second issue',
		'EVIDENCE: return readFileSync(path);',
		'END',
	].join('\n');
	let verifierCalls = 0;
	const executor = scriptedExecutor([
		() => `${FINDER_OUTPUT}\n${extra}`,
		prompt => {
			verifierCalls++;
			const id = /ID: (F\d+)/.exec(prompt)?.[1] ?? 'F1';
			return `VERDICT: CONFIRM\nID: ${id}\nREASON: ok`;
		},
	]);

	const projectRoot = mkdtempSync(join(tmpdir(), 'nc-pipeline-'));
	writeFileSync(join(projectRoot, 'sample.ts'), 'a\nb\nc\n');

	const result = await runDefaultReview(executor, {
		diff: DIFF,
		targetDescription: 'main...feature',
		projectRoot,
		maxVerifiedFindings: 1,
	});

	t.is(verifierCalls, 1);
	t.is(result.confirmed.length, 1);
	const unverified = result.dropped.find(d => d.verdict === 'UNVERIFIED');
	t.truthy(unverified);
	t.true(unverified.reason.includes('cap'));
});

test('pipeline - cancellation before verification drops the rest', async t => {
	const controller = new AbortController();
	const executor = scriptedExecutor([
		() => FINDER_OUTPUT,
		() => 'never runs',
	]);
	controller.abort();

	const projectRoot = mkdtempSync(join(tmpdir(), 'nc-pipeline-'));
	writeFileSync(join(projectRoot, 'sample.ts'), 'a\nb\nc\n');

	const result = await runDefaultReview(executor, {
		diff: DIFF,
		targetDescription: 'main...feature',
		projectRoot,
		signal: controller.signal,
	});

	t.is(result.confirmed.length, 0);
	t.true(result.dropped.some(d => d.reason === 'cancelled'));
});

// ============================================================================
// Agent registration

test('registration - registers both review agents with the read-only ceiling', async t => {
	const loader = getSubagentLoader();
	const {registered, skipped} = await registerReviewAgents(loader);

	t.deepEqual(registered.sort(), [REVIEW_FINDER_AGENT, REVIEW_VERIFIER_AGENT].sort());
	t.is(skipped.length, 0);

	for (const name of [REVIEW_FINDER_AGENT, REVIEW_VERIFIER_AGENT]) {
		const agent = await loader.getSubagent(name);
		t.truthy(agent, `${name} must be registered`);
		t.deepEqual(agent.tools, [...REVIEW_READ_ONLY_TOOLS]);
		t.true(
			agent.systemPrompt.includes('FINDING') ||
				agent.systemPrompt.includes('VERDICT'),
			`${name} must state its output contract`,
		);
	}
});

test.serial('registration - user-defined agent wins over the built-in', async t => {
	const loader = getSubagentLoader();
	loader.registerExternal({
		name: REVIEW_FINDER_AGENT,
		description: 'my project-specific finder',
		systemPrompt: 'project definition',
		source: {priority: 2, isBuiltIn: false},
	});

	const {registered, skipped} = await registerReviewAgents(loader);
	t.true(registered.includes(REVIEW_VERIFIER_AGENT));
	t.true(skipped.includes(REVIEW_FINDER_AGENT));

	const agent = await loader.getSubagent(REVIEW_FINDER_AGENT);
	t.is(agent.systemPrompt, 'project definition');
	t.is(
		loader.unregisterExternal(REVIEW_FINDER_AGENT),
		true,
		'clean up the test override',
	);
});

test('agents - built-in agent names are the ones the pipeline dispatches', t => {
	t.is(REVIEW_FINDER_AGENT, 'review-finder');
	t.is(REVIEW_VERIFIER_AGENT, 'review-verifier');
});

// ============================================================================
// End to end: real loader, real executor, scripted model

test.serial('end to end - scripted model drives find, verify, confirm', async t => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'nc-e2e-review-'));
	writeFileSync(
		join(projectRoot, 'sample.ts'),
		'export function readIt(path: string) {\n  return readFileSync(path);\n}\n',
	);
	setProjectRoot(projectRoot);
	setGlobalToolApprovalHandler(async () => true);

	const toolManager = {
		getAllTools: () => ({
			read_file: {execute: async () => 'export function readIt(...)'},
		}),
		getToolHandler: (name: string) =>
			name === 'read_file'
				? async () => 'export function readIt(...)'
				: undefined,
		getToolEntry: (name: string) =>
			name === 'read_file' ? {approval: false, readOnly: true} : undefined,
		isReadOnly: () => true,
		getToolFormatter: () => undefined,
		getStreamingFormatter: () => undefined,
	} as never;

	// Finder: one tool call, then a cited finding. Verifier: CONFIRM with the
	// ID echoed from the prompt it received.
	const scripts: Array<{
		content: string;
		tool_calls?: Array<{
			id: string;
			function: {name: string; arguments: string};
		}>;
	}> = [
		{
			content: '',
			tool_calls: [
				{
					id: 'tc-1',
					function: {name: 'read_file', arguments: '{"path":"sample.ts"}'},
				},
			],
		},
		{content: FINDER_OUTPUT},
		{content: 'VERDICT: CONFIRM\nID: F1\nREASON: readFileSync is not imported'},
	];

	const chatPrompts: string[] = [];
	let call = 0;
	const client = {
		chat: async (messages: Array<{role: string; content: unknown}>) => {
			chatPrompts.push(
				messages
					.filter(m => m.role === 'user')
					.map(m => String(m.content))
					.join('\n'),
			);
			const response = scripts[Math.min(call, scripts.length - 1)];
			call++;
			return {
				choices: [{message: response}],
				toolsDisabled: false,
			};
		},
		getCurrentModel: () => 'scripted-model',
		setModel: () => {},
		getAvailableModels: async () => ['scripted-model'],
		getContextSize: () => 128000,
		getProviderConfig: () => ({
			name: 'TestProvider',
			type: 'openai',
			models: ['scripted-model'],
			config: {},
		}),
		clearContext: async () => {},
		getTimeout: () => undefined,
	} as never;

	const loader = getSubagentLoader();
	await registerReviewAgents(loader);
	const executor = new SubagentExecutor(toolManager, client);

	const result = await runDefaultReview(executor, {
		diff: DIFF,
		targetDescription: 'main...feature',
		projectRoot,
		loader,
	});

	t.is(call, 3, 'finder turn + finder final + one verifier turn');
	t.true(
		chatPrompts[0].includes('Review the following diff'),
		'finder receives the diff',
	);
	t.true(
		chatPrompts.some(p => p.includes('The finding to verify')),
		'verifier receives the finding',
	);
	t.false(
		chatPrompts.some(p => p.includes('FINDING') && p.includes('Review the following diff') && p.includes('The finding to verify')),
		'finder and verifier prompts stay separate',
	);
	t.is(result.confirmed.length, 1);
	t.is(result.confirmed[0].file, 'sample.ts');
});

test.serial('end to end - verifier output without the ID does not confirm', async t => {
	const projectRoot = mkdtempSync(join(tmpdir(), 'nc-e2e-review-'));
	writeFileSync(join(projectRoot, 'sample.ts'), 'a\nb\nc\n');
	setProjectRoot(projectRoot);
	setGlobalToolApprovalHandler(async () => true);

	const toolManager = {
		getAllTools: () => ({}),
		getToolHandler: () => undefined,
		getToolEntry: () => undefined,
		isReadOnly: () => true,
		getToolFormatter: () => undefined,
		getStreamingFormatter: () => undefined,
	} as never;

	// Finder emits a finding; verifier echoes the WRONG ID (F9).
	const scripts: Array<{content: string}> = [
		{content: FINDER_OUTPUT},
		{content: 'VERDICT: CONFIRM\nID: F9\nREASON: echoed the wrong id'},
	];
	let call = 0;
	const client = {
		chat: async () => {
			const response = scripts[Math.min(call, scripts.length - 1)];
			call++;
			return {choices: [{message: response}], toolsDisabled: false};
		},
		getCurrentModel: () => 'scripted-model',
		setModel: () => {},
		getAvailableModels: async () => ['scripted-model'],
		getContextSize: () => 128000,
		getProviderConfig: () => ({
			name: 'TestProvider',
			type: 'openai',
			models: ['scripted-model'],
			config: {},
		}),
		clearContext: async () => {},
		getTimeout: () => undefined,
	} as never;

	const loader = getSubagentLoader();
	await registerReviewAgents(loader);
	const executor = new SubagentExecutor(toolManager, client);

	const result = await runDefaultReview(executor, {
		diff: DIFF,
		targetDescription: 'main...feature',
		projectRoot,
		loader,
	});

	t.is(result.confirmed.length, 0, 'a mismatched ID must not confirm');
	t.true(result.dropped.some(d => d.verdict === 'UNVERIFIED'));
});

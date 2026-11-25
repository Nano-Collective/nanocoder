import test from 'ava';
import {
	buildPromptDiff,
	createReviewContextTools,
	formatLineRanges,
	type ReviewAgentTool,
} from './review-context';
import {resolveReviewScope} from './review-resolver';
import type {ReviewTargetSnapshot} from './review-snapshot';
import {
	createReviewFixtureTools,
	createReviewGitFixture,
	type ReviewGitFixture,
} from './review-test-helpers';

async function pinFeatureBranch(t: {
	teardown: (fn: () => void) => void;
}): Promise<{
	fixture: ReviewGitFixture;
	snapshot: ReviewTargetSnapshot;
	tools: Map<string, ReviewAgentTool>;
}> {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.write('src/util.ts', 'export function helper() {\n\treturn "needle";\n}\n');
	fixture.runGit(['add', '--', 'src/util.ts']);
	fixture.runGit(['commit', '-m', 'add helper']);
	fixture.runGit(['push', 'origin', 'main']);
	fixture.runGit(['checkout', '-b', 'feature/context']);
	fixture.write(
		'src/file.ts',
		'export const value = 1;\nexport const needle = divide(4, 0);\n',
	);
	fixture.runGit(['add', '--', 'src/file.ts']);
	fixture.runGit(['commit', '-m', 'use needle in file']);
	const foundationTools = createReviewFixtureTools(fixture);
	const resolution = await resolveReviewScope('branch feature/context', {
		tools: foundationTools,
	});
	if (resolution.status !== 'ready') {
		throw new Error(`fixture did not resolve: ${resolution.status}`);
	}
	const tools = createReviewContextTools(resolution.snapshot, foundationTools);
	return {
		fixture,
		snapshot: resolution.snapshot,
		tools: new Map(tools.map(entry => [entry.name, entry])),
	};
}

function tool(tools: Map<string, ReviewAgentTool>, name: string): ReviewAgentTool {
	const entry = tools.get(name);
	if (!entry) throw new Error(`missing tool ${name}`);
	return entry;
}

test('formats changed lines as compact ranges', t => {
	t.is(formatLineRanges([5, 1, 2, 3, 9]), '1-3, 5, 9');
	t.is(formatLineRanges([]), '');
});

test('context tools answer from the pinned revision, not the checkout', async t => {
	const {fixture, tools} = await pinFeatureBranch(t);
	fixture.runGit(['checkout', 'main']);
	fixture.write('src/file.ts', 'checkout drift\n');
	fixture.write('src/util.ts', 'checkout drift\n');

	const changed = await tool(tools, 'review_changed_files').run({});
	t.is(changed, 'M src/file.ts (changed head lines: 2)');

	const diff = await tool(tools, 'review_diff').run({path: 'src/file.ts'});
	t.true(diff.startsWith('diff --git a/src/file.ts b/src/file.ts'));
	t.true(diff.includes('+export const needle = divide(4, 0);'));
	t.regex(
		await tool(tools, 'review_diff').run({path: 'src/util.ts'}),
		/^Error: src\/util.ts is not changed/,
	);

	const read = await tool(tools, 'review_read_file').run({path: 'src/file.ts'});
	t.true(read.includes('2: export const needle = divide(4, 0);'));
	t.false(read.includes('checkout drift'));

	const unchanged = await tool(tools, 'review_read_file').run({
		path: 'src/util.ts',
		start_line: 2,
		end_line: 2,
	});
	t.true(unchanged.includes('lines 2-2 of 3'));
	t.true(unchanged.includes('2: \treturn "needle";'));

	const directory = await tool(tools, 'review_read_file').run({path: 'src'});
	t.true(directory.includes('file.ts'));
	t.true(directory.includes('util.ts'));

	t.regex(
		await tool(tools, 'review_read_file').run({path: 'src/missing.ts'}),
		/^Error: src\/missing.ts could not be read/,
	);
});

test('context tools reject paths that leave the repository', async t => {
	const {tools} = await pinFeatureBranch(t);
	await t.throwsAsync(
		tool(tools, 'review_read_file').run({path: '../../etc/passwd'}),
		{message: /repository-relative path/},
	);
	await t.throwsAsync(tool(tools, 'review_diff').run({path: '/etc/passwd'}), {
		message: /repository-relative path/,
	});
});

test('search covers changed files in memory and the rest of the pinned head', async t => {
	const {tools} = await pinFeatureBranch(t);
	const search = tool(tools, 'review_search');
	const results = await search.run({pattern: 'needle'});
	t.true(results.includes('src/file.ts:2: export const needle = divide(4, 0);'));
	t.true(results.includes('src/util.ts:2: return "needle";'));
	t.is(results.split('\n').filter(line => line.startsWith('src/file.ts')).length, 1);

	const scoped = await search.run({pattern: 'needle', path: 'src/util.ts'});
	t.false(scoped.includes('src/file.ts'));
	t.is(await search.run({pattern: 'no-such-text-anywhere'}), 'No matches for "no-such-text-anywhere".');
	t.regex(await search.run({pattern: ''}), /^Error: pattern/);
});

test('log lists the commits in scope', async t => {
	const {tools} = await pinFeatureBranch(t);
	const log = await tool(tools, 'review_log').run({});
	t.true(log.includes('use needle in file'));
	t.false(log.includes('add helper'));
});

test('prompt diff keeps whole files and reports omitted and binary paths', async t => {
	const {snapshot} = await pinFeatureBranch(t);
	const large = {
		...snapshot.files[0]!,
		path: 'src/large.ts',
		baseContent: '',
		headContent: `${'x\n'.repeat(400)}`,
		status: 'added' as const,
		lineMap: {changedBaseLines: [], changedHeadLines: [1]},
	};
	const binary = {...snapshot.files[0]!, path: 'logo.png', isBinary: true};
	const diff = buildPromptDiff(
		{...snapshot, files: [snapshot.files[0]!, large, binary]},
		{maxLines: 100, maxChars: 10_000},
	);
	t.deepEqual(diff.includedPaths, ['src/file.ts']);
	t.deepEqual(diff.omittedPaths, ['src/large.ts']);
	t.deepEqual(diff.binaryPaths, ['logo.png']);
	t.false(diff.text.includes('src/large.ts'));
});

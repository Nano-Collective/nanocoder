import test from 'ava';
import {ReviewActivityStore} from './review-activity';
import {checkCitation, citedExcerpt} from './review-citations';
import {createCommitSnapshot, type ReviewFileSnapshot, type ReviewTargetSnapshot} from './review-snapshot';
import {createReviewFixtureTools, createReviewGitFixture} from './review-test-helpers';

function file(overrides: Partial<ReviewFileSnapshot>): ReviewFileSnapshot {
	return {
		path: 'src/math.ts',
		status: 'modified',
		baseContent: 'a\n',
		headContent: Array.from({length: 20}, (_, index) => `line ${index + 1}`).join('\n'),
		isBinary: false,
		lineMap: {changedBaseLines: [], changedHeadLines: [10]},
		...overrides,
	};
}

function snapshot(files: ReviewFileSnapshot[]): ReviewTargetSnapshot {
	return {
		repositoryRoot: '/repo',
		baseOid: 'a'.repeat(40),
		headOid: 'b'.repeat(40),
		headKind: 'commit',
		scope: {kind: 'branch', description: 'branch feature'},
		files,
		capturedAt: 0,
	};
}

test('accepts citations on or within three lines of a changed head line', t => {
	const target = snapshot([file({})]);
	t.true(checkCitation(target, {file: 'src/math.ts', line: 10}).ok);
	t.true(checkCitation(target, {file: 'src/math.ts', line: 7}).ok);
	t.true(checkCitation(target, {file: 'src/math.ts', line: 13}).ok);
});

test('rejects citations away from the change, past the end, or outside the scope', t => {
	const target = snapshot([
		file({}),
		file({path: 'img.png', isBinary: true}),
		file({path: 'gone.ts', status: 'deleted', headContent: null}),
	]);
	const far = checkCitation(target, {file: 'src/math.ts', line: 2});
	t.false(far.ok);
	if (!far.ok) t.regex(far.reason, /not in or near a changed line/);

	const past = checkCitation(target, {file: 'src/math.ts', line: 21});
	t.false(past.ok);
	if (!past.ok) t.regex(past.reason, /past the end/);

	const unchanged = checkCitation(target, {file: 'src/other.ts', line: 1});
	t.false(unchanged.ok);
	if (!unchanged.ok) t.regex(unchanged.reason, /not a changed file/);

	t.false(checkCitation(target, {file: 'img.png', line: 1}).ok);
	t.false(checkCitation(target, {file: 'gone.ts', line: 1}).ok);
});

test('cited excerpt marks the cited line and clamps to the file', t => {
	const excerpt = citedExcerpt(file({}), 2, 3);
	const lines = excerpt.split('\n');
	t.is(lines[0], ' 1: line 1');
	t.is(lines[1], '>2: line 2');
	t.is(lines.at(-1), ' 5: line 5');
});

for (const [position, index, anchors] of [
	['start', 0, [1]],
	['middle', 10, [10, 11]],
	['end', 20, [20]],
] as const) {
	test(`deletion-only citations use clamped boundaries at the ${position} of a file`, async t => {
		const fixture = createReviewGitFixture();
		t.teardown(fixture.cleanup);
		const head = Array.from({length: 20}, (_, i) => `line ${i + 1}`);
		const base = [...head];
		base.splice(index, 0, 'removed guard');
		fixture.write('src/math.ts', `${base.join('\n')}\n`);
		fixture.runGit(['add', '--all']);
		fixture.runGit(['commit', '-m', 'add guard']);
		const baseOid = fixture.runGit(['rev-parse', 'HEAD']);
		fixture.write('src/math.ts', `${head.join('\n')}\n`);
		fixture.runGit(['add', '--all']);
		fixture.runGit(['commit', '-m', 'remove guard']);
		const target = await createCommitSnapshot(
			{baseOid, headOid: fixture.runGit(['rev-parse', 'HEAD']), scope: {kind: 'branch', description: 'deletion'}},
			{tools: createReviewFixtureTools(fixture), activity: new ReviewActivityStore()},
		);
		t.deepEqual(target.files[0]!.lineMap.changedHeadLines, []);
		t.deepEqual(target.files[0]!.lineMap.headDeletionAnchors, [...anchors]);
		for (let line = 1; line <= 20; line++) {
			t.is(
				checkCitation(target, {file: 'src/math.ts', line}).ok,
				anchors.some(anchor => Math.abs(anchor - line) <= 3),
				`citation at line ${line}`,
			);
		}
		t.false(checkCitation(target, {file: 'src/math.ts', line: 21}).ok);
	});
}

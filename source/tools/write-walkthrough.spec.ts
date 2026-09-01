import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {ArtifactManager} from '@/artifacts/artifact-manager';
import {ToolManager} from '@/tools/tool-manager';
import {createWriteWalkthroughTool} from './write-walkthrough';

test('write_walkthrough persists a structured session walkthrough', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-walkthrough-'));
	const manager = new ArtifactManager(root);
	const sessionId = '11111111-1111-4111-8111-111111111111';
	const writeWalkthrough = createWriteWalkthroughTool(manager);

	try {
		await writeWalkthrough.tool.execute!(
			{
				summary: 'Added the artifact lifecycle.',
				filesChanged: [
					{
						path: 'source/artifacts/artifact-manager.ts',
						description: 'Persists lifecycle artifacts.',
					},
				],
				tests: [
					{
						command: 'pnpm run test:ava source/artifacts',
						status: 'passed',
						details: 'All artifact tests passed.',
					},
				],
				verificationSteps: ['Open walkthrough.md from the artifact bar.'],
			},
			{toolCallId: 'walkthrough', messages: [], sessionId} as never,
		);

		t.is(
			await manager.readArtifact(sessionId, 'walkthrough'),
			'# Walkthrough\n\n' +
				'## Summary\n\nAdded the artifact lifecycle.\n\n' +
				'## Files Changed\n\n' +
				'- `source/artifacts/artifact-manager.ts` — Persists lifecycle artifacts.\n\n' +
				'## Tests\n\n' +
				'- ✅ `pnpm run test:ava source/artifacts` — All artifact tests passed.\n\n' +
				'## How to Verify\n\n' +
				'1. Open walkthrough.md from the artifact bar.\n',
		);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('write_walkthrough requires either test results or an untested reason', async t => {
	const writeWalkthrough = createWriteWalkthroughTool(
		new ArtifactManager('/tmp/unused'),
	);

	t.deepEqual(
		await writeWalkthrough.validator?.({
			summary: 'Implemented the feature.',
			filesChanged: [],
			tests: [],
			verificationSteps: ['Inspect the generated artifact.'],
		}),
		{valid: false, error: 'Provide test results or explain why tests were not run'},
	);
});

test('write_walkthrough rejects an empty summary', async t => {
	const writeWalkthrough = createWriteWalkthroughTool(
		new ArtifactManager('/tmp/unused'),
	);

	t.deepEqual(
		await writeWalkthrough.validator?.({
			summary: '   ',
			filesChanged: [],
			tests: [],
			untestedReason: 'No executable changes.',
			verificationSteps: ['Inspect the artifact.'],
		}),
		{valid: false, error: 'Walkthrough summary cannot be empty'},
	);
});

test('write_walkthrough reports missing required fields without throwing', async t => {
	const writeWalkthrough = createWriteWalkthroughTool(
		new ArtifactManager('/tmp/unused'),
	);

	t.deepEqual(await writeWalkthrough.validator?.({}), {
		valid: false,
		error: 'Walkthrough summary is required',
	});
});

test('write_walkthrough requires a verification step', async t => {
	const writeWalkthrough = createWriteWalkthroughTool(
		new ArtifactManager('/tmp/unused'),
	);

	t.deepEqual(
		await writeWalkthrough.validator?.({
			summary: 'Implemented the feature.',
			filesChanged: [],
			tests: [],
			untestedReason: 'No executable changes.',
			verificationSteps: [],
		}),
		{valid: false, error: 'Provide at least one verification step'},
	);
});

test('write_walkthrough is exposed only in execution modes', t => {
	const manager = new ToolManager();

	for (const mode of ['normal', 'auto-accept', 'yolo', 'headless'] as const) {
		t.true(
			manager
				.getAvailableToolNames(undefined, mode)
				.includes('write_walkthrough'),
		);
	}
	t.false(
		manager
			.getAvailableToolNames(undefined, 'plan')
			.includes('write_walkthrough'),
	);
});

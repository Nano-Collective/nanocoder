import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {ArtifactManager} from './artifact-manager';
import {
	createApprovedPlanMessage,
	isApprovedPlanMessage,
} from './approved-plan';

test('approved execution message is built from the persisted plan', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-approved-plan-'));
	const manager = new ArtifactManager(root);
	const sessionId = '11111111-1111-4111-8111-111111111111';

	try {
		await manager.writeArtifact(
			sessionId,
			'implementation_plan',
			'# Persisted plan\n\n1. Change the parser.\n',
		);

		const message = await createApprovedPlanMessage(sessionId, manager);

		t.true(message.includes('# Persisted plan'));
		t.true(message.includes('Change the parser'));
		t.true(message.includes('approved'));
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('approved execution messages are identified as synthetic user messages', t => {
	t.true(
		isApprovedPlanMessage({
			role: 'user',
			content:
				'The implementation plan below is approved.\n\n<approved_plan>Implement it.</approved_plan>',
		}),
	);
	t.false(
		isApprovedPlanMessage({
			role: 'assistant',
			content: '<approved_plan>Implement it.</approved_plan>',
		}),
	);
});

const FALLBACK_MESSAGE =
	'The plan above is approved. Proceed with implementing it now.';

test('a missing plan artifact degrades instead of blocking approval', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-approved-plan-'));
	const manager = new ArtifactManager(root);

	try {
		const message = await createApprovedPlanMessage(
			'11111111-1111-4111-8111-111111111111',
			manager,
		);
		t.is(message, FALLBACK_MESSAGE);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('an empty plan artifact degrades instead of blocking approval', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-approved-plan-'));
	const manager = new ArtifactManager(root);
	const sessionId = '11111111-1111-4111-8111-111111111111';

	try {
		await manager.writeArtifact(sessionId, 'implementation_plan', '   \n');
		t.is(await createApprovedPlanMessage(sessionId, manager), FALLBACK_MESSAGE);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('an invalid session id degrades instead of throwing', async t => {
	const root = await mkdtemp(join(tmpdir(), 'nanocoder-approved-plan-'));
	const manager = new ArtifactManager(root);

	try {
		t.is(await createApprovedPlanMessage('', manager), FALLBACK_MESSAGE);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('the degraded approval message is still recognised as synthetic', t => {
	t.true(isApprovedPlanMessage({role: 'user', content: FALLBACK_MESSAGE}));
});

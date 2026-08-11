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

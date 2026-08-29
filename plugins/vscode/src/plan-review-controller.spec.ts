import test from 'ava';
import {PlanReviewController} from './plan-review-controller';

test('PlanReviewController - offers the completed plan after a plan-mode turn', t => {
	const controller = new PlanReviewController();
	const artifactPath = '/tmp/session/implementation_plan.md';

	controller.observeSessionUpdate({
		sessionUpdate: 'tool_call_update',
		toolCallId: 'call-plan',
		status: 'completed',
		_meta: {
			'nanocoder/artifact': {
				kind: 'implementation_plan',
				path: artifactPath,
			},
		},
	});

	t.deepEqual(controller.completeTurn('plan'), {artifactPath});
	t.deepEqual(controller.pendingReview, {artifactPath});
});

test('PlanReviewController - approval exits plan mode before executing the persisted plan', async t => {
	const controller = new PlanReviewController();
	const calls: string[] = [];
	controller.observeSessionUpdate({
		sessionUpdate: 'tool_call_update',
		status: 'completed',
		_meta: {
			'nanocoder/planArtifact': {
				path: '/tmp/session/implementation_plan.md',
			},
		},
	});
	controller.completeTurn('plan');

	await controller.approve({
		readFile: async path => {
			calls.push(`read:${path}`);
			return '# Persisted plan\n\n1. Build it.';
		},
		setMode: async mode => {
			calls.push(`mode:${mode}`);
		},
		prompt: async message => {
			calls.push(`prompt:${message}`);
		},
	});

	t.deepEqual(calls, [
		'read:/tmp/session/implementation_plan.md',
		'mode:normal',
		'prompt:The implementation plan below is approved. Proceed with implementing it now.\n\n<approved_plan>\n# Persisted plan\n\n1. Build it.\n</approved_plan>',
	]);
	t.is(controller.pendingReview, undefined);
});

test('PlanReviewController - an empty plan artifact still approves against the transcript', async t => {
	const controller = new PlanReviewController();
	const artifactPath = '/tmp/session/implementation_plan.md';
	const prompts: string[] = [];
	controller.observeSessionUpdate({
		sessionUpdate: 'tool_call_update',
		status: 'completed',
		_meta: {'nanocoder/planArtifact': {path: artifactPath}},
	});
	controller.completeTurn('plan');

	await controller.approve({
		readFile: async () => '',
		setMode: async () => {},
		prompt: async message => {
			prompts.push(message);
		},
	});

	t.deepEqual(prompts, [
		'The plan above is approved. Proceed with implementing it now.',
	]);
	t.is(controller.pendingReview, undefined);
});

test('PlanReviewController - an unreadable plan artifact still approves', async t => {
	const controller = new PlanReviewController();
	const prompts: string[] = [];
	controller.observeSessionUpdate({
		sessionUpdate: 'tool_call_update',
		status: 'completed',
		_meta: {
			'nanocoder/planArtifact': {path: '/tmp/session/implementation_plan.md'},
		},
	});
	controller.completeTurn('plan');

	await controller.approve({
		readFile: async () => {
			throw new Error('ENOENT');
		},
		setMode: async () => {},
		prompt: async message => {
			prompts.push(message);
		},
	});

	t.deepEqual(prompts, [
		'The plan above is approved. Proceed with implementing it now.',
	]);
	t.is(controller.pendingReview, undefined);
});

test('PlanReviewController - prompt failure restores plan mode and keeps the plan available for retry', async t => {
	const controller = new PlanReviewController();
	const artifactPath = '/tmp/session/implementation_plan.md';
	const modes: string[] = [];
	controller.observeSessionUpdate({
		sessionUpdate: 'tool_call_update',
		status: 'completed',
		_meta: {'nanocoder/planArtifact': {path: artifactPath}},
	});
	controller.completeTurn('plan');

	await t.throwsAsync(
		controller.approve({
			readFile: async () => '# Persisted plan\n\n1. Build it.',
			setMode: async mode => {
				modes.push(mode);
			},
			prompt: async () => {
				throw new Error('transport failed');
			},
		}),
		{message: 'transport failed'},
	);
	t.deepEqual(modes, ['normal', 'plan']);
	t.deepEqual(controller.pendingReview, {artifactPath});
});

test('PlanReviewController - revision clears the card without leaving plan mode', t => {
	const controller = new PlanReviewController();
	controller.observeSessionUpdate({
		sessionUpdate: 'tool_call_update',
		status: 'completed',
		_meta: {
			'nanocoder/planArtifact': {
				path: '/tmp/session/implementation_plan.md',
			},
		},
	});
	controller.completeTurn('plan');

	controller.revise();

	t.is(controller.pendingReview, undefined);
});

test('PlanReviewController - does not carry an artifact across a non-plan turn', t => {
	const controller = new PlanReviewController();
	controller.observeSessionUpdate({
		sessionUpdate: 'tool_call_update',
		status: 'completed',
		_meta: {
			'nanocoder/planArtifact': {
				path: '/tmp/session/implementation_plan.md',
			},
		},
	});

	t.is(controller.completeTurn('normal'), undefined);
	t.is(controller.completeTurn('plan'), undefined);
});

test('PlanReviewController - reset drops artifacts from the previous session', t => {
	const controller = new PlanReviewController();
	controller.observeSessionUpdate({
		sessionUpdate: 'tool_call_update',
		status: 'completed',
		_meta: {
			'nanocoder/planArtifact': {
				path: '/tmp/old-session/implementation_plan.md',
			},
		},
	});

	controller.reset();

	t.is(controller.completeTurn('plan'), undefined);
	t.is(controller.pendingReview, undefined);
});

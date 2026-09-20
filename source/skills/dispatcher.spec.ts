import test from 'ava';
import type {Event, Subscription} from '@/events/types';
import type {SubagentResult, SubagentTask} from '@/subagents/types';
import type {DevelopmentMode} from '@/types/core';
import {
	buildTriggeredTask,
	modeForSubscription,
	SkillDispatcher,
} from './dispatcher';

console.log(`\ndispatcher.spec.ts`);

function fileChangedSub(target: {kind: 'agent' | 'command' | 'tool'; name: string}): Subscription {
	return {
		id: 'sub-1',
		kind: 'file.changed',
		target,
		source: 'frontmatter',
		ownerSkill: 'docs',
		filter: {paths: ['docs/**']},
	};
}

function fileEvent(): Event {
	return {
		kind: 'file.changed',
		payload: {file: 'docs/intro.md', eventKind: 'change'},
		at: 1_700_000_000_000,
	};
}

test('buildTriggeredTask: agent target produces #515-shaped trigger context', t => {
	const task = buildTriggeredTask(
		fileChangedSub({kind: 'agent', name: 'docs-agent'}),
		fileEvent(),
	);
	t.is(task.subagent_type, 'docs-agent');
	t.regex(task.prompt ?? '', /file\.changed/);
	t.regex(task.prompt ?? '', /docs\/intro\.md/);
	t.deepEqual(task.context, {
		trigger: {
			type: 'event',
			kind: 'file.changed',
			payload: {file: 'docs/intro.md', eventKind: 'change'},
		},
	});
});

test('buildTriggeredTask: schedule.cron event produces matching trigger context', t => {
	const sub: Subscription = {
		id: 'sub-2',
		kind: 'schedule.cron',
		target: {kind: 'agent', name: 'weekly'},
		source: 'manifest',
		ownerSkill: 'reports',
		filter: {cron: '0 9 * * MON'},
	};
	const event: Event = {
		kind: 'schedule.cron',
		payload: {cron: '0 9 * * MON'},
		at: 1_700_000_000_000,
	};
	const task = buildTriggeredTask(sub, event);
	t.deepEqual(task.context, {
		trigger: {
			type: 'event',
			kind: 'schedule.cron',
			payload: {cron: '0 9 * * MON'},
		},
	});
});

test('dispatch: routes agent target through executor.execute', async t => {
	const calls: SubagentTask[] = [];
	const dispatcher = new SkillDispatcher({
		buildExecutor: () => ({
			async execute(task) {
				calls.push(task);
				const result: SubagentResult = {
					subagentName: task.subagent_type,
					output: 'done',
					success: true,
					executionTimeMs: 0,
				};
				return result;
			},
		}),
	});

	await dispatcher.dispatch(
		fileChangedSub({kind: 'agent', name: 'docs-agent'}),
		fileEvent(),
	);

	t.is(calls.length, 1);
	t.is(calls[0]?.subagent_type, 'docs-agent');
});

test('dispatch: command target is reported as unsupported', async t => {
	const unsupported: string[] = [];
	const dispatcher = new SkillDispatcher({
		buildExecutor: () => ({
			async execute() {
				return {
					subagentName: 'should-not-be-called',
					output: '',
					success: false,
					executionTimeMs: 0,
				};
			},
		}),
		onUnsupportedTarget: (_sub, reason) => unsupported.push(reason),
	});

	await dispatcher.dispatch(
		fileChangedSub({kind: 'command', name: 'weekly-report'}),
		fileEvent(),
	);
	t.is(unsupported.length, 1);
	t.regex(unsupported[0] ?? '', /command targets/);
});

test('dispatch: tool target is reported as unsupported', async t => {
	const unsupported: string[] = [];
	const dispatcher = new SkillDispatcher({
		buildExecutor: () => ({
			async execute() {
				return {
					subagentName: 'no',
					output: '',
					success: false,
					executionTimeMs: 0,
				};
			},
		}),
		onUnsupportedTarget: (_sub, reason) => unsupported.push(reason),
	});

	await dispatcher.dispatch(
		fileChangedSub({kind: 'tool', name: 'gh_pr_diff'}),
		fileEvent(),
	);
	t.is(unsupported.length, 1);
	t.regex(unsupported[0] ?? '', /tool targets/);
});

test('modeForSubscription: confirm=true → plan, otherwise headless', t => {
	const noConfirm = fileChangedSub({kind: 'agent', name: 'a'});
	t.is(modeForSubscription(noConfirm), 'headless');

	const withConfirm: Subscription = {...noConfirm, confirm: true};
	t.is(modeForSubscription(withConfirm), 'plan');

	const explicitlyFalse: Subscription = {...noConfirm, confirm: false};
	t.is(modeForSubscription(explicitlyFalse), 'headless');
});

test('dispatch: passes mode through to the executor factory', async t => {
	const modes: DevelopmentMode[] = [];
	const dispatcher = new SkillDispatcher({
		buildExecutor: mode => {
			modes.push(mode);
			return {
				async execute() {
					return {
						subagentName: 'x',
						output: '',
						success: true,
						executionTimeMs: 0,
					};
				},
			};
		},
	});

	const sub = fileChangedSub({kind: 'agent', name: 'docs-agent'});
	await dispatcher.dispatch(sub, fileEvent());
	await dispatcher.dispatch({...sub, id: 'sub-2', confirm: true}, fileEvent());

	t.deepEqual(modes, ['headless', 'plan']);
});

test('dispatch: creates a checkpoint before headless run, skips for confirm', async t => {
	const reasons: string[] = [];
	const dispatcher = new SkillDispatcher({
		buildExecutor: () => ({
			async execute() {
				return {
					subagentName: 'x',
					output: '',
					success: true,
					executionTimeMs: 0,
				};
			},
		}),
		checkpointer: {
			async create(reason) {
				reasons.push(reason);
				return `cp-${reasons.length}`;
			},
		},
	});

	const sub = fileChangedSub({kind: 'agent', name: 'docs-agent'});
	await dispatcher.dispatch(sub, fileEvent());
	t.deepEqual(reasons, ['trigger:file.changed:agent:docs-agent']);

	await dispatcher.dispatch({...sub, id: 'sub-2', confirm: true}, fileEvent());
	t.is(reasons.length, 1); // plan-mode run skipped the checkpoint
});

test('dispatch: emits an activity event after the run', async t => {
	const activities: Array<{
		mode: DevelopmentMode;
		checkpointId?: string;
		ok: boolean;
	}> = [];
	const dispatcher = new SkillDispatcher({
		buildExecutor: () => ({
			async execute() {
				return {
					subagentName: 'x',
					output: 'done',
					success: true,
					executionTimeMs: 12,
				};
			},
		}),
		checkpointer: {async create() {
			return 'cp-x';
		}},
		onActivity: a =>
			activities.push({
				mode: a.mode,
				checkpointId: a.checkpointId,
				ok: a.result.success,
			}),
	});

	await dispatcher.dispatch(
		fileChangedSub({kind: 'agent', name: 'docs-agent'}),
		fileEvent(),
	);
	t.is(activities.length, 1);
	t.is(activities[0]?.mode, 'headless');
	t.is(activities[0]?.checkpointId, 'cp-x');
	t.true(activities[0]?.ok);
});

test('dispatch: checkpoint failure does not abort the run', async t => {
	const calls: SubagentTask[] = [];
	const dispatcher = new SkillDispatcher({
		buildExecutor: () => ({
			async execute(task) {
				calls.push(task);
				return {
					subagentName: 'x',
					output: 'done',
					success: true,
					executionTimeMs: 0,
				};
			},
		}),
		checkpointer: {
			async create() {
				throw new Error('disk full');
			},
		},
	});

	await dispatcher.dispatch(
		fileChangedSub({kind: 'agent', name: 'docs-agent'}),
		fileEvent(),
	);
	t.is(calls.length, 1);
});

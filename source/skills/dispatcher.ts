/**
 * The skill-aware `SubscriptionDispatcher`. Sits between the event router
 * and the existing registries: receives a `(subscription, event)` pair,
 * resolves the target, and invokes it in the right way.
 *
 * Step 14 wires the subagent target end-to-end:
 *   - synthesize a `SubagentTask` with `task.context.trigger` (shape
 *     matches issue #515) and a canned `task.prompt` that tells the model
 *     a trigger fired and what its payload looks like;
 *   - hand the task to a `SubagentExecutorLike` to run.
 *
 * Command and tool targets are stubbed - plan open question 4 still owes
 * a concrete re-injection design for command targets, and tool targets
 * are explicitly out of scope per plan step 8.
 *
 * See `agents/2026-05-20-skills-unification-plan.md` step 14.
 */

import type {SubscriptionDispatcher} from '@/events/event-router';
import type {Event, Subscription, TriggerContext} from '@/events/types';
import type {SubagentResult, SubagentTask} from '@/subagents/types';
import type {DevelopmentMode} from '@/types/core';

export interface SubagentExecutorLike {
	execute(task: SubagentTask): Promise<SubagentResult>;
}

export type ExecutorFactory = (mode: DevelopmentMode) => SubagentExecutorLike;

export interface UnsupportedTargetLogger {
	(subscription: Subscription, reason: string): void;
}

/**
 * Wraps `CheckpointManager.saveCheckpoint` so the dispatcher can be
 * exercised in isolation. Returns the checkpoint id (used in surfaced
 * activity messages so the user can revert).
 */
export interface Checkpointer {
	create(reason: string): Promise<string>;
}

/**
 * Summary the dispatcher emits after each triggered run, intended for the
 * daemon's activity surface: a chat message via the message queue and an
 * OS notification. The dispatcher is registry-agnostic, so it only knows
 * what it just did - it's up to the daemon to fan this out into UI.
 */
export interface TriggeredRunActivity {
	subscription: Subscription;
	event: Event;
	mode: DevelopmentMode;
	result: SubagentResult;
	checkpointId?: string;
	durationMs: number;
}

export type ActivityListener = (activity: TriggeredRunActivity) => void;

export interface SkillDispatcherOptions {
	/**
	 * Build a subagent executor for a given mode. The dispatcher calls this
	 * per dispatch so it can choose `headless` for unattended runs and
	 * `plan` for `confirm: true` subscriptions without mutating shared
	 * executor state across concurrent dispatches.
	 */
	buildExecutor: ExecutorFactory;
	/**
	 * Called when an event targets a kind the dispatcher does not (yet)
	 * support. Defaults to a no-op; production wiring routes this through
	 * `logError` from the message queue.
	 */
	onUnsupportedTarget?: UnsupportedTargetLogger;
	/**
	 * Snapshot file state before the triggered run starts. The dispatcher
	 * skips this for `confirm: true` subscriptions (plan-mode runs make no
	 * file mutations to revert).
	 */
	checkpointer?: Checkpointer;
	/**
	 * Called after each completed triggered run, regardless of success.
	 * Production wiring fans this out to chat-message injection and the
	 * `triggeredRunComplete` OS notification.
	 */
	onActivity?: ActivityListener;
}

export class SkillDispatcher implements SubscriptionDispatcher {
	constructor(private readonly options: SkillDispatcherOptions) {}

	async dispatch(subscription: Subscription, event: Event): Promise<void> {
		const target = subscription.target;
		if (target.kind === 'agent') {
			await this.dispatchAgent(subscription, event);
			return;
		}
		if (target.kind === 'command') {
			this.options.onUnsupportedTarget?.(
				subscription,
				'command targets are not yet supported - see open question 4',
			);
			return;
		}
		if (target.kind === 'tool') {
			this.options.onUnsupportedTarget?.(
				subscription,
				'tool targets are deferred until a real use case lands',
			);
			return;
		}
	}

	private async dispatchAgent(
		subscription: Subscription,
		event: Event,
	): Promise<void> {
		const task = buildTriggeredTask(subscription, event);
		const mode = modeForSubscription(subscription);

		let checkpointId: string | undefined;
		if (mode !== 'plan' && this.options.checkpointer) {
			try {
				checkpointId = await this.options.checkpointer.create(
					checkpointReason(subscription, event),
				);
			} catch {
				// Checkpoint failure is non-fatal: the triggered run still
				// proceeds, but the activity report omits the checkpoint id.
			}
		}

		const executor = this.options.buildExecutor(mode);
		const start = Date.now();
		const result = await executor.execute(task);
		const durationMs = Date.now() - start;

		this.options.onActivity?.({
			subscription,
			event,
			mode,
			result,
			checkpointId,
			durationMs,
		});
	}
}

function checkpointReason(subscription: Subscription, event: Event): string {
	const target = `${subscription.target.kind}:${subscription.target.name}`;
	return `trigger:${event.kind}:${target}`;
}

/**
 * Pick the development mode the triggered run should execute in. Default
 * is `headless` (autonomous, no foreground prompts). `confirm: true` opts
 * the subscription into `plan` mode, which surfaces what the subagent
 * would have done without applying any mutations.
 */
export function modeForSubscription(
	subscription: Subscription,
): DevelopmentMode {
	return subscription.confirm ? 'plan' : 'headless';
}

/**
 * Build the `SubagentTask` for a triggered subagent run. Exported so the
 * registrar's spec - and later the daemon - can inspect the exact shape
 * without standing up a full router.
 */
export function buildTriggeredTask(
	subscription: Subscription,
	event: Event,
): SubagentTask {
	const trigger: TriggerContext =
		event.kind === 'file.changed'
			? {type: 'event', kind: 'file.changed', payload: event.payload}
			: {type: 'event', kind: 'schedule.cron', payload: event.payload};

	const payloadJson = JSON.stringify(event.payload);
	const prompt = `An event of kind \`${event.kind}\` fired. Payload: \`${payloadJson}\`. Proceed according to your instructions.`;

	return {
		subagent_type: subscription.target.name,
		description: `Triggered by ${event.kind} (subscription ${subscription.id})`,
		prompt,
		context: {trigger},
	};
}

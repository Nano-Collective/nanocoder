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
 * Command targets run the same way: the command's rendered prompt becomes
 * the task prompt for a generic runner subagent (`COMMAND_RUNNER_AGENT`),
 * which the daemon registers at boot. Tool targets are rejected at
 * registration (see the registrar), so they never reach dispatch.
 *
 * See `agents/2026-05-20-skills-unification-plan.md` step 14.
 */

import type {SubscriptionDispatcher} from '@/events/event-router';
import type {Event, Subscription, TriggerContext} from '@/events/types';
import {
	type SubagentConfigWithSource,
	SubagentLoadPriority,
	type SubagentResult,
	type SubagentTask,
} from '@/subagents/types';
import type {DevelopmentMode} from '@/types/core';

export interface SubagentExecutorLike {
	execute(task: SubagentTask, signal?: AbortSignal): Promise<SubagentResult>;
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

/**
 * Renders a command target's prompt. Returns `undefined` when the command
 * no longer exists. Production wiring renders through
 * `CustomCommandExecutor` with no arguments, so parameter defaults apply.
 */
export type CommandPromptResolver = (
	name: string,
	subscription: Subscription,
) => string | undefined;

/**
 * Name of the generic subagent that runs command targets. The daemon
 * registers it at boot (see `buildCommandRunnerConfig`).
 */
export const COMMAND_RUNNER_AGENT = 'nanocoder-triggered-command';

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
	/**
	 * Resolve a command target to its rendered prompt. Without it, command
	 * targets are reported through `onUnsupportedTarget`.
	 */
	resolveCommandPrompt?: CommandPromptResolver;
}

export class SkillDispatcher implements SubscriptionDispatcher {
	private readonly abortController = new AbortController();
	private readonly activeRuns = new Set<Promise<void>>();

	constructor(private readonly options: SkillDispatcherOptions) {}

	dispatch(subscription: Subscription, event: Event): Promise<void> {
		if (this.abortController.signal.aborted) return Promise.resolve();
		const run = this.dispatchTarget(subscription, event);
		this.activeRuns.add(run);
		// Track the entire dispatch, including checkpoint and activity work.
		// Handle both outcomes so a failed run cannot prevent shutdown.
		void run.then(
			() => this.activeRuns.delete(run),
			() => this.activeRuns.delete(run),
		);
		return run;
	}

	/** Cancel triggered runs and wait for their cleanup before releasing tools. */
	async stop(): Promise<void> {
		this.abortController.abort();
		await Promise.allSettled(this.activeRuns);
	}

	private async dispatchTarget(
		subscription: Subscription,
		event: Event,
	): Promise<void> {
		const target = subscription.target;
		if (target.kind === 'agent') {
			await this.run(
				subscription,
				event,
				buildTriggeredTask(subscription, event),
			);
			return;
		}
		if (target.kind === 'skill') {
			this.options.onUnsupportedTarget?.(
				subscription,
				'skill targets are rejected at registration and should never reach dispatch',
			);
			return;
		}
		if (target.kind === 'command') {
			const rendered = this.options.resolveCommandPrompt?.(
				target.name,
				subscription,
			);
			if (rendered === undefined) {
				this.options.onUnsupportedTarget?.(
					subscription,
					this.options.resolveCommandPrompt
						? `command "${target.name}" was not found`
						: 'no command resolver is wired for command targets',
				);
				return;
			}
			await this.run(
				subscription,
				event,
				buildTriggeredCommandTask(subscription, event, rendered),
			);
			return;
		}
		if (target.kind === 'tool') {
			this.options.onUnsupportedTarget?.(
				subscription,
				'tool targets are rejected at registration and should never reach dispatch',
			);
			return;
		}
	}

	private async run(
		subscription: Subscription,
		event: Event,
		task: SubagentTask,
	): Promise<void> {
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

		// A checkpoint can still be writing when shutdown begins. Let it finish,
		// but do not start another executor once cancellation has been requested.
		if (this.abortController.signal.aborted) return;
		const executor = this.options.buildExecutor(mode);
		const start = Date.now();
		const result = await executor.execute(task, this.abortController.signal);
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

function triggerContextFor(event: Event): TriggerContext {
	switch (event.kind) {
		case 'file.changed':
			return {type: 'event', kind: 'file.changed', payload: event.payload};
		case 'schedule.cron':
			return {type: 'event', kind: 'schedule.cron', payload: event.payload};
		case 'file.ai-comment':
			return {
				type: 'event',
				kind: 'file.ai-comment',
				payload: event.payload,
			};
		case 'ci.job.failed':
			return {type: 'event', kind: 'ci.job.failed', payload: event.payload};
		default: {
			// Exhaustiveness check: a new EventKind added without a case here
			// fails the build instead of silently mislabeling the trigger
			// context with the wrong kind/payload pairing.
			const exhaustive: never = event;
			throw new Error(
				`triggerContextFor: unhandled event kind "${(exhaustive as Event).kind}"`,
			);
		}
	}
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
	const trigger = triggerContextFor(event);

	let prompt: string;
	if (event.kind === 'file.ai-comment') {
		// Special prompt for AI comment markers
		const {file, comment, marker, line, context} = event.payload;
		prompt = `An AI marker (${marker}) was detected in ${file} at line ${line}.

Comment: "${comment}"

Code context:
\`\`\`
${context}
\`\`\`

Please analyze the comment and surrounding code, then implement the requested change or answer the question. Make the necessary code modifications to resolve this issue.`;
	} else {
		// Generic prompt for other event types
		const payloadJson = JSON.stringify(event.payload);
		prompt = `An event of kind \`${event.kind}\` fired. Payload: \`${payloadJson}\`. Proceed according to your instructions.`;
	}

	return {
		subagent_type: subscription.target.name,
		description: `Triggered by ${event.kind} (subscription ${subscription.id})`,
		prompt,
		context: {trigger},
	};
}

/**
 * Build the `SubagentTask` for a triggered command run. The command's
 * rendered prompt is the instruction; the trigger payload is appended so
 * the runner knows why it fired.
 */
function buildTriggeredCommandTask(
	subscription: Subscription,
	event: Event,
	renderedPrompt: string,
): SubagentTask {
	const payloadJson = JSON.stringify(event.payload);
	const prompt = `${renderedPrompt}\n\n[Triggered by an event of kind \`${event.kind}\`. Payload: \`${payloadJson}\`]`;

	return {
		subagent_type: COMMAND_RUNNER_AGENT,
		description: `Triggered /${subscription.target.name} by ${event.kind} (subscription ${subscription.id})`,
		prompt,
		context: {trigger: triggerContextFor(event)},
	};
}

/**
 * The generic runner subagent command targets execute under. It has no
 * tool allowlist, so it sees whatever the run's mode permits.
 */
export function buildCommandRunnerConfig(): SubagentConfigWithSource {
	return {
		name: COMMAND_RUNNER_AGENT,
		description:
			'Runs a custom command unattended when one of its event subscriptions fires.',
		model: 'inherit',
		systemPrompt:
			'You are running a custom command unattended because an event subscription fired. No user is watching: do not ask questions. Carry out the command instructions using your tools, then reply with a short summary of what you did.',
		source: {priority: SubagentLoadPriority.BuiltIn, isBuiltIn: true},
	};
}

/**
 * Cron event source for the skill event router.
 *
 * One process-wide source. Subscriptions register their cron expressions
 * through `register(expr)`; when a matching minute (or second, in croner's
 * 6-field syntax) ticks, the source emits a `schedule.cron` event with
 * `payload.cron` set to the expression that fired. The router then routes
 * to subscriptions whose `filter.cron` matches.
 *
 * The cron job factory is injectable so tests can drive ticks manually
 * without waiting for real time to pass. Production code gets croner's
 * `Cron(expression, onTick)`; tests get a stub that exposes the captured
 * callback.
 *
 * See `agents/2026-05-20-skills-unification-plan.md` step 10.
 */

import {Cron} from 'croner';
import type {EventRouter} from '@/events/event-router';

export interface CronJobLike {
	stop(): void;
}

export type CronFactory = (
	expression: string,
	onTick: () => void,
) => CronJobLike;

const defaultFactory: CronFactory = (expression, onTick) =>
	new Cron(expression, onTick);

export class ScheduleEventSource {
	private readonly jobs: Map<string, CronJobLike> = new Map();
	private readonly refCounts: Map<string, number> = new Map();

	constructor(
		private readonly router: EventRouter,
		private readonly factory: CronFactory = defaultFactory,
	) {}

	/**
	 * Register a cron expression. Shared expressions are reference-counted:
	 * the first caller creates the underlying job, later callers only bump
	 * the count. The router fans each tick out to every matching subscription.
	 */
	register(expression: string): void {
		const count = this.refCounts.get(expression) ?? 0;
		this.refCounts.set(expression, count + 1);
		if (count > 0) return;
		const job = this.factory(expression, () => {
			void this.router.emit({
				kind: 'schedule.cron',
				payload: {cron: expression},
				at: Date.now(),
			});
		});
		this.jobs.set(expression, job);
	}

	/**
	 * Drop one subscription for an expression. The underlying job is stopped
	 * only when the last remaining subscription unregisters.
	 */
	unregister(expression: string): void {
		const count = this.refCounts.get(expression);
		if (count === undefined) return;
		if (count > 1) {
			this.refCounts.set(expression, count - 1);
			return;
		}
		this.refCounts.delete(expression);
		const job = this.jobs.get(expression);
		if (!job) return;
		job.stop();
		this.jobs.delete(expression);
	}

	stop(): void {
		for (const job of this.jobs.values()) job.stop();
		this.jobs.clear();
		this.refCounts.clear();
	}

	listRegistered(): string[] {
		return [...this.jobs.keys()];
	}
}

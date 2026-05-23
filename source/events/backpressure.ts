/**
 * Backpressure protections for the event router, wrapped around an inner
 * dispatcher. Two protections, both default-on:
 *
 *   1. Per-subscription concurrency cap = 1. If an event arrives while a
 *      previous run for the same subscription is in flight, drop the new
 *      one. Stops a `git pull` (1000 file-change events in 200ms) from
 *      blowing up into 1000 parallel subagent runs.
 *
 *   2. Trailing-edge debounce, 500ms, applied to `file.changed` events
 *      only. Events within the window reset the timer; on expiry, the most
 *      recent event is dispatched once. Cron and future kinds opt in as
 *      they prove noisy.
 *
 * Per the plan, neither protection has v1 config knobs (debounceMs is
 * available here only as a testing seam).
 *
 * See `agents/2026-05-20-skills-unification-plan.md` step 11.
 */

import type {SubscriptionDispatcher} from './event-router';
import type {Event, Subscription, SubscriptionId} from './types';

export interface BackpressureOptions {
	/** Override the trailing-edge debounce window. Defaults to 500ms. */
	debounceMs?: number;
	/**
	 * Called when an event is dropped because a previous run for the same
	 * subscription is in flight. Hook is for telemetry / debug-level logs.
	 */
	onDrop?: (subscription: Subscription, event: Event) => void;
}

const DEFAULT_DEBOUNCE_MS = 500;

export class BackpressureDispatcher implements SubscriptionDispatcher {
	private readonly inFlight: Set<SubscriptionId> = new Set();
	private readonly debouncers: Map<SubscriptionId, NodeJS.Timeout> = new Map();
	private readonly pendingEvents: Map<
		SubscriptionId,
		{sub: Subscription; event: Event}
	> = new Map();

	constructor(
		private readonly inner: SubscriptionDispatcher,
		private readonly options: BackpressureOptions = {},
	) {}

	dispatch(sub: Subscription, event: Event): void | Promise<void> {
		if (event.kind === 'file.changed') {
			this.scheduleDebounced(sub, event);
			return;
		}
		return this.dispatchImmediate(sub, event);
	}

	private scheduleDebounced(sub: Subscription, event: Event): void {
		this.pendingEvents.set(sub.id, {sub, event});
		const existing = this.debouncers.get(sub.id);
		if (existing) clearTimeout(existing);

		const timer = setTimeout(() => {
			this.debouncers.delete(sub.id);
			const pending = this.pendingEvents.get(sub.id);
			if (pending) {
				this.pendingEvents.delete(sub.id);
				void this.dispatchImmediate(pending.sub, pending.event);
			}
		}, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
		this.debouncers.set(sub.id, timer);
	}

	private async dispatchImmediate(
		sub: Subscription,
		event: Event,
	): Promise<void> {
		if (this.inFlight.has(sub.id)) {
			this.options.onDrop?.(sub, event);
			return;
		}
		this.inFlight.add(sub.id);
		try {
			await this.inner.dispatch(sub, event);
		} finally {
			this.inFlight.delete(sub.id);
		}
	}

	/**
	 * Clear pending debouncers. The daemon calls this on shutdown so timers
	 * don't keep the event loop alive. In-flight runs are not interrupted
	 * (they're the inner dispatcher's responsibility).
	 */
	dispose(): void {
		for (const timer of this.debouncers.values()) clearTimeout(timer);
		this.debouncers.clear();
		this.pendingEvents.clear();
	}
}

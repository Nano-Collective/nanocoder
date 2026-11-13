/**
 * Routes events from event sources (file watcher, cron, future kinds) to
 * matching subscriptions, then hands each matched subscription to a
 * dispatcher that knows how to invoke the target member.
 *
 * The router is registry-agnostic by design: it does NOT call
 * SubagentExecutor / CustomCommandLoader / ToolRegistry directly. The
 * `SubscriptionDispatcher` interface decouples matching from invocation so
 * the router can be unit-tested without standing up a full toolchain, and
 * so the dispatcher can evolve (plan-mode for confirm:true, checkpointing,
 * activity surfacing) without touching the router.
 *
 * See `agents/2026-05-20-skills-unification-plan.md` step 8.
 */

import {formatError} from '@/utils/error-formatter';
import {globMatches} from '@/utils/fs/glob-match';
import type {Event, EventKind, Subscription} from './types';

export interface SubscriptionDispatcher {
	dispatch(subscription: Subscription, event: Event): Promise<void> | void;
}

export class EventRouter {
	private readonly byKind: Map<EventKind, Subscription[]> = new Map();
	private readonly byId: Map<string, Subscription> = new Map();

	constructor(
		private readonly dispatcher: SubscriptionDispatcher,
		/** Called once per subscription whose dispatch threw or rejected. */
		private readonly onDispatchError: (
			subscription: Subscription,
			event: Event,
			error: unknown,
		) => void = logDispatchError,
	) {}

	subscribe(subscription: Subscription): void {
		if (this.byId.has(subscription.id)) {
			throw new Error(
				`Subscription id "${subscription.id}" is already registered.`,
			);
		}
		this.byId.set(subscription.id, subscription);
		const list = this.byKind.get(subscription.kind) ?? [];
		list.push(subscription);
		this.byKind.set(subscription.kind, list);
	}

	unsubscribe(id: string): boolean {
		const sub = this.byId.get(id);
		if (!sub) return false;
		this.byId.delete(id);
		const list = this.byKind.get(sub.kind);
		if (list) {
			const filtered = list.filter(s => s.id !== id);
			if (filtered.length === 0) this.byKind.delete(sub.kind);
			else this.byKind.set(sub.kind, filtered);
		}
		return true;
	}

	listByKind(kind: EventKind): Subscription[] {
		return [...(this.byKind.get(kind) ?? [])];
	}

	all(): Subscription[] {
		return [...this.byId.values()];
	}

	async emit(event: Event): Promise<void> {
		const candidates = this.byKind.get(event.kind);
		if (!candidates || candidates.length === 0) return;

		// Every match runs at once. A dispatch resolves only when its whole
		// triggered run ends, so awaiting them in turn made the second
		// subscription wait out the first, and one throw skipped the rest.
		// Per-subscription limits belong to the dispatcher (BackpressureDispatcher).
		// emit() never rejects: sources fire it with `void`, where a rejection
		// would be unhandled.
		const matches = candidates.filter(sub => matchesFilter(sub, event));
		const results = await Promise.allSettled(
			matches.map(async sub => this.dispatcher.dispatch(sub, event)),
		);
		results.forEach((result, i) => {
			const sub = matches[i];
			if (result.status === 'rejected' && sub) {
				this.onDispatchError(sub, event, result.reason);
			}
		});
	}
}

function logDispatchError(
	subscription: Subscription,
	event: Event,
	error: unknown,
): void {
	console.error(
		`Subscription "${subscription.id}" failed on ${event.kind}: ${formatError(error)}`,
	);
}

export function matchesFilter(sub: Subscription, event: Event): boolean {
	if (sub.kind !== event.kind) return false;

	if (event.kind === 'file.changed' && sub.kind === 'file.changed') {
		const filter = sub.filter;
		if (!filter) return true;
		if (
			filter.eventKinds &&
			!filter.eventKinds.includes(event.payload.eventKind)
		) {
			return false;
		}
		if (filter.paths && filter.paths.length > 0) {
			return filter.paths.some(pattern =>
				matchGlob(pattern, event.payload.file),
			);
		}
		return true;
	}

	if (event.kind === 'schedule.cron' && sub.kind === 'schedule.cron') {
		const filter = sub.filter;
		if (!filter) return true;
		return filter.cron === event.payload.cron;
	}

	if (event.kind === 'ci.job.failed' && sub.kind === 'ci.job.failed') {
		const filter = sub.filter;
		if (!filter?.branches || filter.branches.length === 0) return true;
		return filter.branches.some(pattern =>
			matchGlob(pattern, event.payload.branch),
		);
	}

	return false;
}

/**
 * Rewrite Windows separators to `/` so patterns and paths meet on one shape.
 *
 * Subscription globs are always authored with `/`, but chokidar reports
 * changes using the platform separator — on Windows `docs/**` would be asked
 * to match `docs\guide.md` and never could. The matcher below also leans on
 * `/` to stop `*` at a directory boundary, so an un-normalized path makes
 * `*.md` match the nested `sub\a.md` as well.
 */
export function toPosixPath(path: string): string {
	return path.split('\\').join('/');
}

/**
 * Whether `path` matches a subscription, formatter or hook glob. Uses the
 * shared matcher in utils/fs/glob-match (`*`, `?`, `**`, `{a,b}`; no `!`
 * negation), after normalising both sides to `/`.
 *
 * A pattern ending in `**` + `/` keeps its long-standing meaning here of
 * "anything under this directory", so `docs/**` + `/` matches `docs/a.md`.
 * A pattern the matcher refuses (too long, or too many brace combinations)
 * matches nothing rather than throwing out of the event loop.
 */
export function matchGlob(pattern: string, path: string): boolean {
	let glob = toPosixPath(pattern);
	if (glob.endsWith('**/')) glob = glob.slice(0, -1);
	try {
		return globMatches(toPosixPath(path), glob);
	} catch {
		return false;
	}
}

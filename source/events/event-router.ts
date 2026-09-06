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

import type {Event, EventKind, Subscription} from './types';

export interface SubscriptionDispatcher {
	dispatch(subscription: Subscription, event: Event): Promise<void> | void;
}

export class EventRouter {
	private readonly byKind: Map<EventKind, Subscription[]> = new Map();
	private readonly byId: Map<string, Subscription> = new Map();

	constructor(private readonly dispatcher: SubscriptionDispatcher) {}

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

		const matches = candidates.filter(sub => matchesFilter(sub, event));
		for (const sub of matches) {
			await this.dispatcher.dispatch(sub, event);
		}
	}
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

// Minimal glob -> regex matcher: enough for `docs/<star><star>`,
// `src/<star><star>/*.ts`, `<star><star>/*.md`, literal paths, `?`
// single-character wildcards, and `{a,b}` alternation. Negation (`!`) is not
// supported. chokidar 5 depends only on readdirp, so picomatch is no longer in
// the tree and swapping to it would mean taking a new direct dependency.
export function matchGlob(pattern: string, path: string): boolean {
	const regex = globToRegex(toPosixPath(pattern));
	return regex.test(toPosixPath(path));
}

/**
 * Whether every `{` in the pattern has a matching `}`. An unbalanced brace is
 * treated as a literal, which is what the matcher did before alternation
 * existed, rather than building a regex that would throw.
 */
function hasBalancedBraces(pattern: string): boolean {
	let depth = 0;
	for (const ch of pattern) {
		if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth < 0) return false;
		}
	}
	return depth === 0;
}

function globToRegex(pattern: string): RegExp {
	const alternation = hasBalancedBraces(pattern);
	let depth = 0;
	let out = '';
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i];
		if (alternation && ch === '{') {
			out += '(?:';
			depth++;
		} else if (alternation && ch === '}' && depth > 0) {
			out += ')';
			depth--;
		} else if (alternation && ch === ',' && depth > 0) {
			out += '|';
		} else if (ch === '*') {
			const next = pattern[i + 1];
			if (next === '*') {
				// `**` matches any characters including `/`
				out += '.*';
				i++;
				// Consume a trailing `/` after `**` so `docs/**` matches `docs`
				if (pattern[i + 1] === '/') i++;
			} else {
				// `*` matches anything except `/`
				out += '[^/]*';
			}
		} else if (ch === '?') {
			out += '[^/]';
		} else if (
			ch === '.' ||
			ch === '+' ||
			ch === '(' ||
			ch === ')' ||
			ch === '|' ||
			ch === '^' ||
			ch === '$' ||
			ch === '{' ||
			ch === '}' ||
			ch === '[' ||
			ch === ']' ||
			ch === '\\'
		) {
			out += `\\${ch}`;
		} else {
			out += ch;
		}
	}
	// `out` is built by the escape loop above: every character is either a
	// literal escaped with `\\`, or one of the fixed substrings `[^/]`, `.*`,
	// `[^/]*`, `(?:`, `|`, `)`. There is no user-supplied raw regex syntax in
	// `out`, and the braces were checked for balance before any group opened.
	// The shape is bounded by the glob length, so ReDoS is not reachable.
	// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
	return new RegExp(`^${out}$`);
}

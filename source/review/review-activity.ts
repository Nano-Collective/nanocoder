import {randomUUID} from 'node:crypto';

export type ReviewActivitySource = 'review' | 'agent' | 'tool' | 'api';
export type ReviewActivityStatus =
	| 'started'
	| 'progress'
	| 'completed'
	| 'failed'
	| 'cancelled';

export interface ReviewActivityUpdate {
	at: number;
	summary: string;
}

export interface ReviewActivityEvent {
	id: string;
	reviewId: string;
	parentId?: string;
	source: ReviewActivitySource;
	name: string;
	status: ReviewActivityStatus;
	startedAt: number;
	updatedAt: number;
	endedAt?: number;
	durationMs?: number;
	safeArgs?: string[];
	updates: ReviewActivityUpdate[];
	error?: string;
}

export interface ReviewActivitySummary {
	version: 1;
	reviewId: string;
	status: 'running' | 'completed' | 'failed' | 'cancelled';
	startedAt: number;
	endedAt?: number;
	droppedEventCount: number;
	events: ReviewActivityEvent[];
}

export interface ReviewActivityStart {
	source: ReviewActivitySource;
	name: string;
	summary: string;
	args?: string[];
	parentId?: string;
}

export interface ReviewActivityStoreOptions {
	reviewId?: string;
	maxEvents?: number;
	maxUpdatesPerEvent?: number;
	now?: () => number;
}

export interface ReviewActivitySpan {
	readonly id: string;
	progress(summary: string): void;
	complete(summary?: string): void;
	fail(error: unknown, summary?: string): void;
	cancel(summary?: string): void;
}

const DEFAULT_MAX_EVENTS = 500;
const DEFAULT_MAX_UPDATES_PER_EVENT = 20;
const MAX_SUMMARY_LENGTH = 240;
const MAX_ERROR_LENGTH = 240;
const MAX_ARGUMENT_LENGTH = 160;
const MAX_ARGUMENTS = 12;
const TERMINAL_STATUSES = new Set<ReviewActivityStatus>([
	'completed',
	'failed',
	'cancelled',
]);

const SECRET_VALUE_PATTERNS = [
	/\b(authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi,
	/\b(bearer)\s+[A-Za-z0-9._~+/=-]+/gi,
	/\b(token|password|secret|api[_-]?key|access[_-]?key)\s*[:=]\s*["']?[^"'&\s]+/gi,
	/\bgh[pousr]_[A-Za-z0-9_]{12,}\b/gi,
	/\b(?:sk|pk)-[A-Za-z0-9_-]{16,}\b/gi,
	/\bhttps?:\/\/[^/@\s]+:[^/@\s]+@/gi,
];

function scrubString(value: string, maxLength: number): string {
	let safe = value
		.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
		.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
		.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ');
	for (const pattern of SECRET_VALUE_PATTERNS) {
		safe = safe.replace(pattern, match => {
			if (
				/^(?:authorization|proxy-authorization|cookie|set-cookie)\b/i.test(
					match,
				)
			) {
				return `${match.slice(0, match.search(/[:=]/))}: [REDACTED]`;
			}
			const separator = match.search(/[:=]\s*|\s+/);
			return separator < 0
				? '[REDACTED]'
				: `${match.slice(0, separator)} [REDACTED]`;
		});
	}
	safe = safe
		.replace(/[\r\n\t]+/g, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim();
	return safe.length > maxLength ? `${safe.slice(0, maxLength - 1)}…` : safe;
}

export function sanitizeReviewActivityText(
	value: string,
	maxLength = MAX_SUMMARY_LENGTH,
): string {
	return scrubString(value, maxLength);
}

function safeArgs(args: string[] | undefined): string[] | undefined {
	if (!args?.length) return undefined;
	const boundedArgs = args.slice(0, MAX_ARGUMENTS);
	return boundedArgs.map((arg, index) => {
		const previous = String(boundedArgs[index - 1] ?? '');
		if (
			/^-{1,2}(?:token|password|secret|api[-_]?key|access[-_]?key|authorization|cookie)$/i.test(
				previous,
			)
		) {
			return '[REDACTED]';
		}
		return scrubString(String(arg), MAX_ARGUMENT_LENGTH);
	});
}

function isSource(value: unknown): value is ReviewActivitySource {
	return (
		value === 'review' ||
		value === 'agent' ||
		value === 'tool' ||
		value === 'api'
	);
}

function isStatus(value: unknown): value is ReviewActivityStatus {
	return (
		value === 'started' ||
		value === 'progress' ||
		value === 'completed' ||
		value === 'failed' ||
		value === 'cancelled'
	);
}

function isFiniteTimestamp(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normalizeEvent(
	value: unknown,
	reviewId: string,
): ReviewActivityEvent | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Partial<ReviewActivityEvent>;
	if (
		typeof candidate.id !== 'string' ||
		typeof candidate.name !== 'string' ||
		!isSource(candidate.source) ||
		!isStatus(candidate.status) ||
		!isFiniteTimestamp(candidate.startedAt) ||
		!isFiniteTimestamp(candidate.updatedAt) ||
		!Array.isArray(candidate.updates)
	) {
		return null;
	}

	const updates = candidate.updates
		.filter(
			(update): update is ReviewActivityUpdate =>
				!!update &&
				typeof update === 'object' &&
				isFiniteTimestamp((update as ReviewActivityUpdate).at) &&
				typeof (update as ReviewActivityUpdate).summary === 'string',
		)
		.slice(-DEFAULT_MAX_UPDATES_PER_EVENT)
		.map(update => ({
			at: update.at,
			summary: scrubString(update.summary, MAX_SUMMARY_LENGTH),
		}));

	const event: ReviewActivityEvent = {
		id: scrubString(candidate.id, 180),
		reviewId,
		source: candidate.source,
		name: scrubString(candidate.name, 80),
		status: candidate.status,
		startedAt: candidate.startedAt,
		updatedAt: candidate.updatedAt,
		updates,
	};
	if (typeof candidate.parentId === 'string') {
		event.parentId = scrubString(candidate.parentId, 180);
	}
	if (isFiniteTimestamp(candidate.endedAt)) event.endedAt = candidate.endedAt;
	if (
		typeof candidate.durationMs === 'number' &&
		Number.isFinite(candidate.durationMs) &&
		candidate.durationMs >= 0
	) {
		event.durationMs = candidate.durationMs;
	}
	if (Array.isArray(candidate.safeArgs)) {
		event.safeArgs = safeArgs(candidate.safeArgs.map(String));
	}
	if (typeof candidate.error === 'string') {
		event.error = scrubString(candidate.error, MAX_ERROR_LENGTH);
	}
	return event;
}

/**
 * Per-review bounded activity log. Each span keeps a stable ID while its
 * lifecycle status and safe progress summaries are updated in place.
 */
export class ReviewActivityStore {
	readonly reviewId: string;
	private readonly maxEvents: number;
	private readonly maxUpdatesPerEvent: number;
	private readonly now: () => number;
	private readonly listeners = new Set<() => void>();
	private readonly events: ReviewActivityEvent[] = [];
	private nextEventNumber = 1;
	private droppedEventCount = 0;
	private status: ReviewActivitySummary['status'] = 'running';
	private readonly startedAt: number;
	private endedAt: number | undefined;

	constructor(options: ReviewActivityStoreOptions = {}) {
		this.reviewId = options.reviewId ?? randomUUID();
		this.maxEvents = Math.max(1, options.maxEvents ?? DEFAULT_MAX_EVENTS);
		this.maxUpdatesPerEvent = Math.max(
			1,
			options.maxUpdatesPerEvent ?? DEFAULT_MAX_UPDATES_PER_EVENT,
		);
		this.now = options.now ?? Date.now;
		this.startedAt = this.now();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	getEvents(): readonly ReviewActivityEvent[] {
		return this.events.map(event => ({
			...event,
			updates: [...event.updates],
			...(event.safeArgs ? {safeArgs: [...event.safeArgs]} : {}),
		}));
	}

	getStatus(): ReviewActivitySummary['status'] {
		return this.status;
	}

	begin(input: ReviewActivityStart): ReviewActivitySpan {
		if (this.status !== 'running') {
			throw new Error('Cannot add activity to a finished review.');
		}
		const at = this.now();
		const id = `${this.reviewId}:event:${this.nextEventNumber++}`;
		const event: ReviewActivityEvent = {
			id,
			reviewId: this.reviewId,
			source: input.source,
			name: scrubString(input.name, 80),
			status: 'started',
			startedAt: at,
			updatedAt: at,
			updates: [{at, summary: scrubString(input.summary, MAX_SUMMARY_LENGTH)}],
		};
		if (input.parentId) event.parentId = input.parentId;
		const args = safeArgs(input.args);
		if (args) event.safeArgs = args;
		this.events.push(event);
		this.trimEvents();
		this.notify();

		let isFinished = false;
		const update = (
			status: ReviewActivityStatus,
			summary?: string,
			error?: unknown,
		) => {
			if (isFinished) return;
			const current = this.events.find(candidate => candidate.id === id);
			if (!current) return;
			const updatedAt = this.now();
			current.status = status;
			current.updatedAt = updatedAt;
			if (summary) {
				current.updates.push({
					at: updatedAt,
					summary: scrubString(summary, MAX_SUMMARY_LENGTH),
				});
				if (current.updates.length > this.maxUpdatesPerEvent) {
					current.updates.splice(
						0,
						current.updates.length - this.maxUpdatesPerEvent,
					);
				}
			}
			if (TERMINAL_STATUSES.has(status)) {
				isFinished = true;
				current.endedAt = updatedAt;
				current.durationMs = Math.max(0, updatedAt - current.startedAt);
			}
			if (error !== undefined) {
				current.error = scrubString(
					error instanceof Error ? error.message : String(error),
					MAX_ERROR_LENGTH,
				);
			}
			this.notify();
		};

		return {
			id,
			progress: summary => update('progress', summary),
			complete: summary => update('completed', summary),
			fail: (error, summary) => update('failed', summary, error),
			cancel: summary => update('cancelled', summary),
		};
	}

	finish(status: Exclude<ReviewActivitySummary['status'], 'running'>): void {
		if (this.status !== 'running') return;
		this.status = status;
		this.endedAt = this.now();
		this.notify();
	}

	toSummary(): ReviewActivitySummary {
		return {
			version: 1,
			reviewId: this.reviewId,
			status: this.status,
			startedAt: this.startedAt,
			...(this.endedAt === undefined ? {} : {endedAt: this.endedAt}),
			droppedEventCount: this.droppedEventCount,
			events: this.events.map(event => ({
				...event,
				updates: [...event.updates],
				...(event.safeArgs ? {safeArgs: [...event.safeArgs]} : {}),
			})),
		};
	}

	private trimEvents(): void {
		const excess = this.events.length - this.maxEvents;
		if (excess <= 0) return;
		this.events.splice(0, excess);
		this.droppedEventCount += excess;
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}

/** Parse persisted trace data without trusting its strings or unbounded arrays. */
export function parseReviewActivitySummary(
	value: unknown,
): ReviewActivitySummary | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Partial<ReviewActivitySummary>;
	if (
		candidate.version !== 1 ||
		typeof candidate.reviewId !== 'string' ||
		!isFiniteTimestamp(candidate.startedAt) ||
		!Array.isArray(candidate.events) ||
		(candidate.status !== 'running' &&
			candidate.status !== 'completed' &&
			candidate.status !== 'failed' &&
			candidate.status !== 'cancelled')
	) {
		return null;
	}
	const reviewId = scrubString(candidate.reviewId, 120);
	const events = candidate.events
		.slice(-DEFAULT_MAX_EVENTS)
		.map(event => normalizeEvent(event, reviewId))
		.filter((event): event is ReviewActivityEvent => event !== null);
	const summary: ReviewActivitySummary = {
		version: 1,
		reviewId,
		status: candidate.status,
		startedAt: candidate.startedAt,
		droppedEventCount:
			typeof candidate.droppedEventCount === 'number' &&
			Number.isFinite(candidate.droppedEventCount) &&
			candidate.droppedEventCount > 0
				? Math.min(Math.floor(candidate.droppedEventCount), 1_000_000_000)
				: 0,
		events,
	};
	if (isFiniteTimestamp(candidate.endedAt)) summary.endedAt = candidate.endedAt;
	return summary;
}

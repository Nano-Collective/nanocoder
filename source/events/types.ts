/**
 * Types for the event router and event sources.
 *
 * Event sources (file watcher, cron ticker, future kinds) emit `Event`
 * objects into the router. The router matches them against `Subscription`
 * objects (produced by the skill registrar from declared `SkillTrigger`s)
 * and dispatches to the target member.
 *
 * See `agents/2026-05-20-skills-unification-plan.md` (Event Triggers
 * section) for the full design.
 */

import type {FileChangeEventKind, SkillMemberRef} from '@/types/skills';

export type EventKind = 'file.changed' | 'schedule.cron';

export interface FileChangedPayload {
	file: string;
	eventKind: FileChangeEventKind;
}

export interface ScheduleCronPayload {
	cron: string;
}

interface EventBase {
	/** ms since epoch - set by the source at emit time. */
	at: number;
}

export interface FileChangedEvent extends EventBase {
	kind: 'file.changed';
	payload: FileChangedPayload;
}

export interface ScheduleCronEvent extends EventBase {
	kind: 'schedule.cron';
	payload: ScheduleCronPayload;
}

export type Event = FileChangedEvent | ScheduleCronEvent;

/**
 * Convenience alias for code that wants to talk about a specific kind's
 * payload (e.g. for synthesizing a `TriggerContext`).
 */
export type EventPayload<K extends EventKind> = K extends 'file.changed'
	? FileChangedPayload
	: K extends 'schedule.cron'
		? ScheduleCronPayload
		: never;

export interface FileChangedFilter {
	paths?: string[];
	eventKinds?: FileChangeEventKind[];
}

export interface ScheduleCronFilter {
	cron: string;
}

export type SubscriptionSource = 'frontmatter' | 'manifest';

export type SubscriptionId = string;

interface SubscriptionBase {
	id: SubscriptionId;
	target: SkillMemberRef;
	source: SubscriptionSource;
	/** Name of the skill that declared this subscription. */
	ownerSkill: string;
	/** When true, the dispatched run executes in plan mode. */
	confirm?: boolean;
}

export interface FileChangedSubscription extends SubscriptionBase {
	kind: 'file.changed';
	filter?: FileChangedFilter;
}

export interface ScheduleCronSubscription extends SubscriptionBase {
	kind: 'schedule.cron';
	filter?: ScheduleCronFilter;
}

export type Subscription = FileChangedSubscription | ScheduleCronSubscription;

/**
 * Trigger context propagated into a subagent task's `context` field when
 * the router dispatches an event-driven run. Shape matches issue #515.
 */
export interface TriggerContext<K extends EventKind = EventKind> {
	type: 'event';
	kind: K;
	payload: EventPayload<K>;
}

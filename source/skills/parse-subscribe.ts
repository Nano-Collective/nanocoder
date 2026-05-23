/**
 * Parse a `subscribe:` block from skill YAML into typed `SkillTrigger`s.
 *
 * The same shape appears in three places:
 *   - bundle `skill.yaml` (manifest form - `target` is required)
 *   - command/subagent/tool frontmatter (single-file form - `target` is
 *     implicit `self` and must be omitted)
 *   - manifest member frontmatter inside a bundle (same as single-file)
 *
 * This helper handles parsing and per-entry validation. Target-presence
 * rules (omitted in frontmatter, required in manifest) are enforced by the
 * callers, since they know which surface they are parsing.
 */

import type {
	FileChangedTrigger,
	FileChangeEventKind,
	ScheduleCronTrigger,
	SkillTrigger,
} from '@/types/skills';

const FILE_EVENT_KINDS: ReadonlySet<FileChangeEventKind> = new Set([
	'add',
	'change',
	'unlink',
]);

export class SubscribeParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SubscribeParseError';
	}
}

/**
 * Parse a raw YAML value into a list of `SkillTrigger`s.
 *
 * Returns `undefined` when the value is `undefined` or `null` (no block
 * present). Throws `SubscribeParseError` for any structural issue so the
 * caller can decide whether to log-and-skip or hard-error.
 */
export function parseSubscribeBlock(raw: unknown): SkillTrigger[] | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (!Array.isArray(raw)) {
		throw new SubscribeParseError(
			'"subscribe" must be a list of subscription entries',
		);
	}
	return raw.map((entry, index) => parseTrigger(entry, index));
}

function parseTrigger(raw: unknown, index: number): SkillTrigger {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new SubscribeParseError(
			`subscribe[${index}] must be a mapping with at least a "kind" field`,
		);
	}
	const obj = raw as Record<string, unknown>;
	const kind = obj.kind;
	if (typeof kind !== 'string') {
		throw new SubscribeParseError(`subscribe[${index}].kind must be a string`);
	}

	const base = parseCommonFields(obj, index);

	if (kind === 'file.changed') {
		return {...base, ...parseFileChanged(obj, index)};
	}
	if (kind === 'schedule.cron') {
		return {...base, ...parseScheduleCron(obj, index)};
	}
	throw new SubscribeParseError(
		`subscribe[${index}].kind "${kind}" is not a supported event kind (expected: file.changed, schedule.cron)`,
	);
}

function parseCommonFields(
	obj: Record<string, unknown>,
	index: number,
): {target?: string; confirm?: boolean} {
	const out: {target?: string; confirm?: boolean} = {};

	if (obj.target !== undefined) {
		if (typeof obj.target !== 'string' || !obj.target.trim()) {
			throw new SubscribeParseError(
				`subscribe[${index}].target must be a non-empty string of form "kind:name"`,
			);
		}
		out.target = obj.target;
	}

	if (obj.confirm !== undefined) {
		if (typeof obj.confirm !== 'boolean') {
			throw new SubscribeParseError(
				`subscribe[${index}].confirm must be a boolean`,
			);
		}
		out.confirm = obj.confirm;
	}

	return out;
}

function parseFileChanged(
	obj: Record<string, unknown>,
	index: number,
): FileChangedTrigger {
	const trigger: FileChangedTrigger = {kind: 'file.changed'};

	if (obj.paths !== undefined) {
		if (
			!Array.isArray(obj.paths) ||
			!obj.paths.every((p): p is string => typeof p === 'string')
		) {
			throw new SubscribeParseError(
				`subscribe[${index}].paths must be an array of glob strings`,
			);
		}
		trigger.paths = obj.paths;
	}

	if (obj.eventKinds !== undefined) {
		if (
			!Array.isArray(obj.eventKinds) ||
			!obj.eventKinds.every(
				(k): k is FileChangeEventKind =>
					typeof k === 'string' &&
					FILE_EVENT_KINDS.has(k as FileChangeEventKind),
			)
		) {
			throw new SubscribeParseError(
				`subscribe[${index}].eventKinds must be an array of "add" | "change" | "unlink"`,
			);
		}
		trigger.eventKinds = obj.eventKinds;
	}

	return trigger;
}

function parseScheduleCron(
	obj: Record<string, unknown>,
	index: number,
): ScheduleCronTrigger {
	const cron = obj.cron;
	if (typeof cron !== 'string' || !cron.trim()) {
		throw new SubscribeParseError(
			`subscribe[${index}].cron must be a non-empty cron expression`,
		);
	}
	return {kind: 'schedule.cron', cron};
}

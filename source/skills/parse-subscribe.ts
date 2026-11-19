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

import {validateCron} from '@/schedule/cron';
import type {
	CiJobFailedTrigger,
	FileAiCommentTrigger,
	FileChangedTrigger,
	FileChangeEventKind,
	ScheduleCronTrigger,
	SkillTrigger,
} from '@/types/skills';
import {notifyError} from '@/utils/message-queue-core';

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

/**
 * Parse a `subscribe:` block from a single-file command, agent or tool.
 * A malformed block is logged and dropped: the file still loads, just
 * without triggers. All three member kinds share this so a bad block is
 * handled the same way everywhere.
 */
export function parseSubscribeBlockOrWarn(
	raw: unknown,
	filePath: string,
): SkillTrigger[] | undefined {
	try {
		return parseSubscribeBlock(raw);
	} catch (err) {
		if (err instanceof SubscribeParseError) {
			notifyError(
				`Invalid subscribe block in ${filePath}: ${err.message}. Loaded without triggers.`,
			);
			return undefined;
		}
		throw err;
	}
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

	assertKnownKeys(obj, kind, index);
	const base = parseCommonFields(obj, index);

	if (kind === 'file.changed') {
		return {...base, ...parseFileChanged(obj, index)};
	}
	if (kind === 'file.ai-comment') {
		return {...base, ...parseFileAiComment(obj, index)};
	}
	if (kind === 'schedule.cron') {
		return {...base, ...parseScheduleCron(obj, index)};
	}
	if (kind === 'ci.job.failed') {
		return {...base, ...parseCiJobFailed(obj, index)};
	}
	throw new SubscribeParseError(
		`subscribe[${index}].kind "${kind}" is not a supported event kind (expected: file.changed, file.ai-comment, schedule.cron, ci.job.failed)`,
	);
}

const COMMON_KEYS = ['kind', 'target', 'confirm'];

const KIND_KEYS: Record<string, readonly string[]> = {
	'file.changed': ['paths', 'eventKinds'],
	'file.ai-comment': ['paths'],
	'schedule.cron': ['cron'],
	'ci.job.failed': ['branches'],
};

/**
 * Reject keys the trigger kind does not define. A typo such as `path:` for
 * `paths:` would otherwise be dropped silently and the trigger would match
 * everything.
 */
function assertKnownKeys(
	obj: Record<string, unknown>,
	kind: string,
	index: number,
): void {
	const own = KIND_KEYS[kind];
	if (!own) return; // unsupported kind: reported by the caller
	const allowed = [...COMMON_KEYS, ...own];
	for (const key of Object.keys(obj)) {
		if (allowed.includes(key)) continue;
		const hint = closestKey(key, allowed);
		throw new SubscribeParseError(
			`subscribe[${index}] has unknown key "${key}" for kind "${kind}"` +
				(hint
					? `. Did you mean "${hint}"?`
					: ` (expected: ${allowed.join(', ')})`),
		);
	}
}

function closestKey(
	key: string,
	candidates: readonly string[],
): string | undefined {
	let best: string | undefined;
	let bestDist = 3;
	for (const c of candidates) {
		const d = editDistance(key.toLowerCase(), c.toLowerCase());
		if (d < bestDist) {
			bestDist = d;
			best = c;
		}
	}
	return best;
}

function editDistance(a: string, b: string): number {
	let prev = Array.from({length: b.length + 1}, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		for (let j = 1; j <= b.length; j++) {
			cur[j] = Math.min(
				prev[j] + 1,
				cur[j - 1] + 1,
				prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
		}
		prev = cur;
	}
	return prev[b.length];
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

function parseFileAiComment(
	obj: Record<string, unknown>,
	index: number,
): FileAiCommentTrigger {
	const trigger: FileAiCommentTrigger = {kind: 'file.ai-comment'};

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
	const invalid = validateCron(cron);
	if (invalid) {
		throw new SubscribeParseError(
			`subscribe[${index}].cron "${cron}" is not a valid cron expression: ${invalid}`,
		);
	}
	return {kind: 'schedule.cron', cron};
}

function parseCiJobFailed(
	obj: Record<string, unknown>,
	index: number,
): CiJobFailedTrigger {
	const trigger: CiJobFailedTrigger = {kind: 'ci.job.failed'};

	if (obj.branches !== undefined) {
		if (
			!Array.isArray(obj.branches) ||
			!obj.branches.every((b): b is string => typeof b === 'string')
		) {
			throw new SubscribeParseError(
				`subscribe[${index}].branches must be an array of glob strings`,
			);
		}
		trigger.branches = obj.branches;
	}

	return trigger;
}

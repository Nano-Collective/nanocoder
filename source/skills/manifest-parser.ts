/**
 * Parse a bundle skill's `skill.yaml` into a validated `SkillManifest`.
 *
 * Throws `SkillManifestParseError` on any structural problem. Member
 * existence checks (does `agent:docs-agent` resolve to a real file in this
 * bundle?) live in the bundle loader - this parser only enforces the
 * manifest's intrinsic shape and the syntactic form of `target` strings.
 */

import {readFileSync} from 'node:fs';
import {
	parseSubscribeBlock,
	SubscribeParseError,
} from '@/skills/parse-subscribe';
import type {
	SkillManifest,
	SkillToolVisibility,
	SkillTrigger,
} from '@/types/skills';
import {parseYamlObject} from '@/utils/frontmatter';

const SKILL_NAME_REGEX = /^[a-z][a-z0-9-]*$/;
const TARGET_REGEX = /^(command|agent|tool):[a-z][a-z0-9_-]*$/;
const VALID_VISIBILITIES: ReadonlySet<SkillToolVisibility> = new Set([
	'global',
	'scoped',
]);

export class SkillManifestParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SkillManifestParseError';
	}
}

export function parseSkillManifest(filePath: string): SkillManifest {
	const content = readFileSync(filePath, 'utf-8');
	return parseSkillManifestContent(content);
}

export function parseSkillManifestContent(content: string): SkillManifest {
	const raw = parseYamlObject(content);
	if (raw === null) {
		throw new SkillManifestParseError('skill.yaml is not a valid YAML mapping');
	}
	return validateManifest(raw);
}

function validateManifest(raw: Record<string, unknown>): SkillManifest {
	const name = raw.name;
	if (typeof name !== 'string' || !SKILL_NAME_REGEX.test(name)) {
		throw new SkillManifestParseError(
			`Invalid or missing "name" - must match ${SKILL_NAME_REGEX} (kebab-case starting with a letter)`,
		);
	}

	const description = raw.description;
	if (typeof description !== 'string' || !description.trim()) {
		throw new SkillManifestParseError('Missing or empty "description"');
	}

	const manifest: SkillManifest = {
		name,
		description: description.trim(),
	};

	const version = optionalString(raw.version, 'version');
	if (version !== undefined) manifest.version = version;

	const author = optionalString(raw.author, 'author');
	if (author !== undefined) manifest.author = author;

	const tags = parseTags(raw.tags);
	if (tags !== undefined) manifest.tags = tags;

	const include = parseInclude(raw.include);
	if (include !== undefined) manifest.include = include;

	const subscribe = parseManifestSubscribe(raw.subscribe);
	if (subscribe !== undefined) manifest.subscribe = subscribe;

	const visibility = parseToolsVisibility(raw.tools_visibility);
	if (visibility !== undefined) manifest.tools_visibility = visibility;

	return manifest;
}

function optionalString(value: unknown, label: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string') {
		throw new SkillManifestParseError(`"${label}" must be a string`);
	}
	return value;
}

function parseTags(value: unknown): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (
		!Array.isArray(value) ||
		!value.every((v): v is string => typeof v === 'string')
	) {
		throw new SkillManifestParseError('"tags" must be an array of strings');
	}
	return value;
}

function parseInclude(value: unknown): SkillManifest['include'] {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new SkillManifestParseError('"include" must be a mapping');
	}
	const include: NonNullable<SkillManifest['include']> = {};
	const obj = value as Record<string, unknown>;
	for (const key of ['commands', 'agents', 'tools'] as const) {
		const entry = obj[key];
		if (entry === undefined) continue;
		if (
			!Array.isArray(entry) ||
			!entry.every((p): p is string => typeof p === 'string')
		) {
			throw new SkillManifestParseError(
				`"include.${key}" must be an array of glob strings`,
			);
		}
		entry.forEach((item, i) => assertSafePath(item, `include.${key}[${i}]`));
		include[key] = entry;
	}
	return include;
}

function parseManifestSubscribe(value: unknown): SkillTrigger[] | undefined {
	let triggers: SkillTrigger[] | undefined;
	try {
		triggers = parseSubscribeBlock(value);
	} catch (err) {
		if (err instanceof SubscribeParseError) {
			throw new SkillManifestParseError(err.message);
		}
		throw err;
	}
	if (!triggers) return undefined;

	triggers.forEach((trig, i) => {
		if (!trig.target) {
			throw new SkillManifestParseError(
				`subscribe[${i}].target is required in skill.yaml - manifest subscriptions must name a member as "kind:name"`,
			);
		}
		if (!TARGET_REGEX.test(trig.target)) {
			throw new SkillManifestParseError(
				`subscribe[${i}].target "${trig.target}" must match ${TARGET_REGEX} (e.g. "agent:foo", "command:bar", "tool:baz")`,
			);
		}
		if (trig.kind === 'file.changed' && trig.paths) {
			trig.paths.forEach((p, j) =>
				assertSafePath(p, `subscribe[${i}].paths[${j}]`),
			);
		}
	});

	return triggers;
}

function parseToolsVisibility(
	value: unknown,
): SkillManifest['tools_visibility'] {
	if (value === undefined || value === null) return undefined;

	// Shorthand: `tools_visibility: scoped` (or `global`) is equivalent to
	// `tools_visibility: {default: <value>}`. Easier to write and reads the
	// same way at a glance.
	if (typeof value === 'string') {
		if (!VALID_VISIBILITIES.has(value as SkillToolVisibility)) {
			throw new SkillManifestParseError(
				`"tools_visibility" must be one of: ${[...VALID_VISIBILITIES].join(', ')} (got "${value}")`,
			);
		}
		return {default: value as SkillToolVisibility};
	}

	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new SkillManifestParseError(
			'"tools_visibility" must be a mapping or one of: global, scoped',
		);
	}
	const obj = value as Record<string, unknown>;
	const def = obj.default;
	if (
		typeof def !== 'string' ||
		!VALID_VISIBILITIES.has(def as SkillToolVisibility)
	) {
		throw new SkillManifestParseError(
			`"tools_visibility.default" must be one of: ${[...VALID_VISIBILITIES].join(', ')}`,
		);
	}
	return {default: def as SkillToolVisibility};
}

function assertSafePath(path: string, label: string): void {
	if (path.startsWith('/') || path.startsWith('\\')) {
		throw new SkillManifestParseError(
			`"${label}" must be a relative path (got "${path}")`,
		);
	}
	if (
		path === '..' ||
		path.startsWith('../') ||
		path.startsWith('..\\') ||
		path.includes('/../') ||
		path.includes('\\..\\') ||
		path.endsWith('/..') ||
		path.endsWith('\\..')
	) {
		throw new SkillManifestParseError(
			`"${label}" must not traverse upward with ".." (got "${path}")`,
		);
	}
}

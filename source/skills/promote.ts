/**
 * Move a loaded skill between storage levels.
 *
 * `promote` copies a project-level skill up to the global/personal config
 * dir, making it available in every repo on the machine. `demote` copies a
 * global (or built-in) skill down into the current project's `.nanocoder/`
 * so it gets committed and travels with the repo.
 *
 * Both directions reduce to one copy: a bundle copies its `<name>/`
 * directory, a single-file skill copies its one `.md` into the matching
 * flat dir (`commands|agents|tools`). The skill registry only holds the
 * shadow-winning copy, so destination-existence is checked directly on disk
 * and an overwrite requires an explicit `force`.
 *
 * See `/skills promote` / `/skills demote` in `source/commands/skills.tsx`.
 */

import {access, cp, mkdir} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {getConfigPath} from '@/config/paths';
import type {Skill} from '@/types/skills';

export type PromoteDirection = 'promote' | 'demote';

export type SkillLevel = 'global' | 'project';

export interface PromotionPlan {
	skillName: string;
	shape: 'single-file' | 'bundle';
	/** Current level the skill resolves from. */
	fromLevel: 'built-in' | 'personal' | 'project';
	/** Level the copy is written to. */
	toLevel: SkillLevel;
	source: string;
	dest: string;
}

/** The flat dir a single-file skill lives in, derived from its one member. */
function singleFileDir(skill: Skill): string {
	if (skill.commands?.length) return 'commands';
	if (skill.subagent) return 'agents';
	if (skill.tools?.length) return 'tools';
	// Unreachable for a valid single-file skill (always has exactly one
	// member); guard so a malformed skill fails loudly rather than silently
	// copying to the wrong place.
	throw new Error(
		`Skill "${skill.name}" has no members; cannot resolve its directory.`,
	);
}

/** Destination root for a level: bundles get `skills/`, flat dirs are direct. */
function destPath(
	skill: Skill,
	level: SkillLevel,
	projectRoot: string,
): string {
	const base =
		level === 'global' ? getConfigPath() : join(projectRoot, '.nanocoder');
	if (skill.source.shape === 'bundle') {
		return join(base, 'skills', skill.name);
	}
	return join(base, singleFileDir(skill), basename(skill.source.rootPath));
}

/**
 * Validate the requested move and resolve concrete source/dest paths.
 * Returns either a ready-to-apply plan or a human-readable error.
 */
export function planPromotion(
	skill: Skill,
	direction: PromoteDirection,
	projectRoot: string,
): {plan: PromotionPlan} | {error: string} {
	const {priority} = skill.source;

	if (direction === 'promote') {
		if (priority === 'personal') {
			return {error: `"${skill.name}" is already at the global level.`};
		}
		if (priority === 'built-in') {
			return {
				error: `"${skill.name}" is a built-in skill; there is nothing to promote.`,
			};
		}
	} else if (priority === 'project') {
		return {error: `"${skill.name}" is already at the project level.`};
	}

	const toLevel: SkillLevel = direction === 'promote' ? 'global' : 'project';
	return {
		plan: {
			skillName: skill.name,
			shape: skill.source.shape,
			fromLevel: priority,
			toLevel,
			source: skill.source.rootPath,
			dest: destPath(skill, toLevel, projectRoot),
		},
	};
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export interface ApplyResult {
	ok: boolean;
	/** True when the destination already exists and `force` was not set. */
	destExists?: boolean;
	error?: string;
}

/**
 * Execute a plan. Refuses to overwrite an existing destination unless
 * `force` is true, so a promoted skill never clobbers a different copy at
 * the target level by accident.
 */
export async function applyPromotion(
	plan: PromotionPlan,
	force: boolean,
): Promise<ApplyResult> {
	if (!force && (await exists(plan.dest))) {
		return {ok: false, destExists: true};
	}
	try {
		await mkdir(dirname(plan.dest), {recursive: true});
		await cp(plan.source, plan.dest, {recursive: true, force: true});
		return {ok: true};
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

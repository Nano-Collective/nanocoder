/**
 * Process-wide store for skills loaded at boot time. Read by the `/skills`
 * slash command and other UI surfaces that need to inspect what loaded.
 *
 * The bootstrap calls `setLoadedSkills` once per init; the `/skills`
 * command reads via `getLoadedSkills`. Kept deliberately small - this is
 * a singleton for in-process state, not a registry implementation.
 */

import type {SkillLoadError} from '@/skills/bundle-loader';
import type {SkillCollision} from '@/skills/registrar';
import type {Skill} from '@/types/skills';

interface SkillRegistryState {
	skills: Skill[];
	loadErrors: SkillLoadError[];
	collisions: SkillCollision[];
}

let state: SkillRegistryState = {
	skills: [],
	loadErrors: [],
	collisions: [],
};

export function setLoadedSkills(next: SkillRegistryState): void {
	state = next;
}

export function getLoadedSkills(): Skill[] {
	return state.skills;
}

export function findSkill(name: string): Skill | undefined {
	return state.skills.find(s => s.name === name);
}

export function resetSkillRegistry(): void {
	state = {skills: [], loadErrors: [], collisions: []};
}

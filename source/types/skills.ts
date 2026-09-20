/**
 * Types for the unified skill primitive.
 *
 * A skill is the user-facing unit of extension. It comes in two equivalent
 * forms: a single `.md` file in `.nanocoder/commands|agents|tools/` (the
 * single-file form) or a directory under `.nanocoder/skills/` with a
 * `skill.yaml` manifest (the bundle form). Both forms normalize to the same
 * runtime `Skill` shape, which is then fanned out into the existing
 * command / subagent / tool registries.
 *
 * See `agents/2026-05-20-skills-unification-plan.md` for the full design.
 */

import type {SubagentConfig} from '@/subagents/types';
import type {CustomCommand} from '@/types/commands';
import type {ToolEntry} from '@/types/core';

export type SkillMemberKind = 'command' | 'agent' | 'tool';

/**
 * Resolved reference to a single skill member. The string form used in YAML
 * (`agent:foo`, `command:bar`, `tool:baz`) is parsed into this shape by the
 * registrar before subscriptions are dispatched.
 */
export interface SkillMemberRef {
	kind: SkillMemberKind;
	name: string;
}

export type SkillShape = 'single-file' | 'bundle';

export type SkillPriority = 'built-in' | 'personal' | 'project';

/**
 * Whether a skill's tools are visible globally (default for single-file
 * skills, preserves today's `.nanocoder/tools/*.md` behaviour) or scoped to
 * the owning skill's subagent (default for bundles).
 */
export type SkillToolVisibility = 'global' | 'scoped';

export interface SkillCommandMember {
	command: CustomCommand;
	filePath: string;
}

export interface SkillSubagentMember {
	subagent: SubagentConfig;
	filePath: string;
}

export interface SkillToolMember {
	tool: ToolEntry;
	filePath: string;
}

interface SkillTriggerBase {
	/**
	 * Member target in `kind:name` form (`agent:foo`, `command:bar`,
	 * `tool:baz`). Required on manifest-declared subscriptions. Omitted on
	 * member-frontmatter-declared subscriptions, where it implicitly targets
	 * the member that owns the frontmatter.
	 */
	target?: string;
	/**
	 * When true, the triggered run executes in plan mode (propose, don't
	 * apply) instead of headless mode. Per-subscription opt-in.
	 */
	confirm?: boolean;
}

export type FileChangeEventKind = 'add' | 'change' | 'unlink';

export interface FileChangedTrigger extends SkillTriggerBase {
	kind: 'file.changed';
	paths?: string[];
	eventKinds?: FileChangeEventKind[];
}

export interface ScheduleCronTrigger extends SkillTriggerBase {
	kind: 'schedule.cron';
	cron: string;
}

/**
 * A subscription declaration as it appears in user-authored YAML (either a
 * bundle manifest's `subscribe:` block or a member file's frontmatter).
 * The registrar resolves these into runtime `Subscription` objects.
 */
export type SkillTrigger = FileChangedTrigger | ScheduleCronTrigger;

export interface SkillSource {
	priority: SkillPriority;
	shape: SkillShape;
	/** File path for single-file skills, directory path for bundles. */
	rootPath: string;
}

/**
 * Parsed shape of a bundle's `skill.yaml`. Field names match the YAML
 * (`tools_visibility`, not `toolsVisibility`) so the parser can map keys
 * one-to-one.
 */
export interface SkillManifest {
	name: string;
	description: string;
	version?: string;
	author?: string;
	tags?: string[];
	include?: {
		commands?: string[];
		agents?: string[];
		tools?: string[];
	};
	subscribe?: SkillTrigger[];
	tools_visibility?: {
		default: SkillToolVisibility;
	};
}

/**
 * Runtime representation of a loaded skill. Produced by either the
 * single-file adapter (one member, derived metadata) or the bundle loader
 * (any subset of members, explicit manifest). Downstream registration code
 * cannot tell the two apart.
 */
export interface Skill {
	name: string;
	description: string;
	version?: string;
	author?: string;
	tags?: string[];

	/**
	 * Zero or more command members. Single-file command skills produce
	 * exactly one entry. Bundles can have any number; bundle commands
	 * are auto-namespaced under the bundle name (e.g. `k8s:status`)
	 * unless the file basename equals the bundle name.
	 */
	commands?: SkillCommandMember[];
	subagent?: SkillSubagentMember;
	tools?: SkillToolMember[];

	subscribe?: SkillTrigger[];
	toolsVisibility: SkillToolVisibility;

	source: SkillSource;
}

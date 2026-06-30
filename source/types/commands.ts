import type {ApiCallRecord, ApiUsageSnapshot, Message} from '@/types/core';

export interface Command<T = React.ReactElement | void> {
	name: string;
	description: string;
	handler: (
		args: string[],
		messages: Message[],
		metadata: {
			provider: string;
			model: string;
			tokens: number;
			getMessageTokens: (message: Message) => number;
			client?: import('@/types/core').LLMClient | null;
			tune?: import('@/types/config').TuneConfig;
			developmentMode?: import('@/types/core').DevelopmentMode;
			lastApiUsage?: ApiUsageSnapshot | null;
			apiCallHistory?: ApiCallRecord[];
		},
	) => Promise<T>;
}

/**
 * A slash command registered without eagerly importing its module. The
 * `load()` thunk is invoked only when the command is first executed, which
 * keeps the ~31 built-in command modules out of startup. Metadata (name,
 * description) must be duplicated here so the command picker can render
 * without triggering the lazy load.
 */
export interface LazyCommand {
	name: string;
	description: string;
	load: () => Promise<Command>;
}

export interface ParsedCommand {
	isCommand: boolean;
	command?: string;
	args?: string[];
	fullCommand?: string;
	// Bash command properties
	isBashCommand?: boolean;
	bashCommand?: string;
}

export interface CustomCommandMetadata {
	description?: string;
	aliases?: string[];
	parameters?: string[];
	// Skill-like fields (all optional)
	tags?: string[];
	triggers?: string[];
	estimatedTokens?: number;
	category?: string;
	version?: string;
	author?: string;
	examples?: string[];
	references?: string[];
	dependencies?: string[];
}

export interface CommandResource {
	name: string;
	path: string;
	type: 'script' | 'template' | 'document' | 'config';
	description?: string;
	executable?: boolean;
}

export interface CustomCommand {
	name: string;
	path: string;
	namespace?: string;
	fullName: string; // e.g., "refactor:dry" or just "test"
	metadata: CustomCommandMetadata;
	content: string; // The markdown content without frontmatter
	// Skill-like fields (populated for commands with auto-injection capabilities)
	source?: 'personal' | 'project';
	lastModified?: Date;
	loadedResources?: CommandResource[];
	/**
	 * Event subscriptions declared in the file's frontmatter, if any.
	 * Target is implicit (this command). Resolved by the skill registrar.
	 */
	subscribe?: import('@/types/skills').SkillTrigger[];
}

export interface ParsedCustomCommand {
	metadata: CustomCommandMetadata;
	content: string;
	/**
	 * Event subscriptions declared in the file's frontmatter, if any. Target
	 * is implicit (the command itself) and resolved by the skill registrar.
	 */
	subscribe?: import('@/types/skills').SkillTrigger[];
}

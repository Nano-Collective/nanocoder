import {Message} from '@/types/core';

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
		},
	) => Promise<T>;
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
}

export interface ParsedCustomCommand {
	metadata: CustomCommandMetadata;
	content: string;
}

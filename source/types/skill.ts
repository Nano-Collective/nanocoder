/**
 * Skill system types: modular capabilities with progressive disclosure,
 * tool access control, and bundled resources.
 */

export interface SkillMetadata {
	/** Stable id for loading (e.g. "project:my-skill") */
	id?: string;
	name: string;
	description: string;
	category: string;
	allowedTools?: string[];
	tags?: string[];
	triggers?: string[];
	estimatedTokens?: number;
}

export interface SkillContent {
	instructions: string;
	examples?: string[];
	references?: string[];
	dependencies?: string[];
}

export interface SkillResource {
	name: string;
	path: string;
	type: 'script' | 'template' | 'document' | 'config';
	description?: string;
	executable?: boolean;
}

export interface SkillSource {
	type: 'personal' | 'project' | 'plugin' | 'remote';
	location: string;
	priority: number;
	enabled: boolean;
}

export interface Skill {
	id: string;
	name: string;
	description: string;
	category: string;
	version: string;
	author?: string;
	metadata: SkillMetadata;
	content?: SkillContent;
	allowedTools?: string[];
	blockedTools?: string[];
	resources?: SkillResource[];
	source: SkillSource;
	location: string;
	lastModified: Date;
}

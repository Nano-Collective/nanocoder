/**
 * Subagent System Type Definitions
 *
 * This module defines all TypeScript types for the subagent system.
 * Subagents are specialized AI agents that can be delegated specific tasks.
 */

/**
 * Configuration for a subagent definition.
 * This can be loaded from markdown files or defined programmatically.
 */
export interface SubagentConfig {
	/** Unique identifier for the subagent */
	name: string;
	/** Description of when to use this subagent */
	description: string;
	/** Model to use ('haiku', 'sonnet', 'opus', or 'inherit' from parent) */
	model?: 'haiku' | 'sonnet' | 'opus' | 'inherit';
	/** List of allowed tool names (empty = all tools allowed) */
	tools?: string[];
	/** List of disallowed tool names */
	disallowedTools?: string[];
	/** Permission mode for tool execution */
	permissionMode?: 'readOnly' | 'normal' | 'autoAccept';
	/** List of MCP server names to scope access */
	mcpServers?: string[];
	/** Maximum number of conversation turns (undefined = unlimited) */
	maxTurns?: number;
	/** System prompt / instructions for the subagent */
	systemPrompt: string;
}

/**
 * Task to delegate to a subagent.
 * This is the payload when the LLM requests to use a subagent.
 */
export interface SubagentTask {
	/** Which subagent to use */
	subagent_type: string;
	/** Brief description of what the subagent should do */
	description: string;
	/** Additional context/prompt for the subagent (optional) */
	prompt?: string;
	/** Additional context to pass to the subagent (optional) */
	context?: Record<string, unknown>;
}

/**
 * Result returned from a subagent execution.
 */
export interface SubagentResult {
	/** Name of the subagent that was executed */
	subagentName: string;
	/** Output/response from the subagent */
	output: string;
	/** Whether the execution was successful */
	success: boolean;
	/** Error message if execution failed */
	error?: string;
	/** Number of tokens used (if available) */
	tokensUsed?: number;
	/** Execution time in milliseconds */
	executionTimeMs: number;
}

/**
 * Isolated context for a subagent execution.
 * This prevents subagent state from polluting the main conversation.
 */
export interface SubagentContext {
	/** Filtered tools available to this subagent */
	availableTools: string[];
	/** System message for this subagent */
	systemMessage: string;
	/** Initial messages to start the conversation */
	initialMessages: Array<{
		role: 'user' | 'assistant' | 'system';
		content: string;
	}>;
	/** Permission mode for this execution */
	permissionMode: 'readOnly' | 'normal' | 'autoAccept';
}

/**
 * Priority order for loading subagent definitions.
 * Higher priority definitions override lower priority ones.
 */
export enum SubagentLoadPriority {
	/** Built-in defaults (lowest priority) */
	BuiltIn = 0,
	/** User-level configuration (~/.config/nanocoder/agents/) */
	User = 1,
	/** Project-level configuration (.nanocoder/agents/) (highest priority) */
	Project = 2,
}

/**
 * Metadata about where a subagent config was loaded from.
 */
export interface SubagentSource {
	/** Priority level of this source */
	priority: SubagentLoadPriority;
	/** File path if loaded from file */
	filePath?: string;
	/** Whether this is a built-in subagent */
	isBuiltIn: boolean;
}

/**
 * A subagent config with its source information.
 */
export interface SubagentConfigWithSource extends SubagentConfig {
	/** Source information for this config */
	source: SubagentSource;
}

/**
 * Auto-delegation suggestion from the AutoDelegator.
 */
export interface DelegationSuggestion {
	/** Whether delegation should occur */
	shouldDelegate: boolean;
	/** Which subagent to use (if delegating) */
	subagent?: string;
	/** Reason for the delegation suggestion */
	reason?: string;
}

/**
 * Frontmatter schema for markdown-based subagent definitions.
 * This is parsed from the YAML frontmatter of .md files.
 */
export interface SubagentFrontmatter {
	/** Subagent name */
	name: string;
	/** Description of when to use */
	description: string;
	/** Model to use */
	model?: 'haiku' | 'sonnet' | 'opus' | 'inherit';
	/** Allowed tools */
	tools?: string[];
	/** Disallowed tools */
	disallowedTools?: string[];
	/** Permission mode */
	permissionMode?: 'readOnly' | 'normal' | 'autoAccept';
	/** MCP servers to scope */
	mcpServers?: string[];
	/** Max conversation turns */
	maxTurns?: number;
}

/**
 * Parsed markdown subagent file.
 */
export interface ParsedSubagentFile {
	/** The subagent configuration */
	config: SubagentConfig;
	/** Source file path */
	filePath: string;
	/** Priority level */
	priority: SubagentLoadPriority;
}

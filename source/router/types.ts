/**
 * Types for the Router + Specialist system.
 *
 * When a local provider is active, user messages are classified into a
 * specialist category so the model only sees a small, focused set of tools
 * instead of the full tool registry. This directly addresses the #1 problem
 * with local models: tool hallucination when given too many options.
 *
 * Design adapted from LocalClaw's Router + Specialist architecture.
 */

/** Categories the router can classify a message into. */
export type SpecialistCategory =
	| 'chat'
	| 'code_edit'
	| 'code_explore'
	| 'shell'
	| 'git'
	| 'web'
	| 'task'
	| 'multi';

/** All valid specialist category names. */
export const SPECIALIST_CATEGORIES: readonly SpecialistCategory[] = [
	'chat',
	'code_edit',
	'code_explore',
	'shell',
	'git',
	'web',
	'task',
	'multi',
] as const;

export interface ClassifyResult {
	category: SpecialistCategory;
	confidence:
		| 'pre_model_override'
		| 'model'
		| 'keyword'
		| 'sticky'
		| 'fallback';
}

/** Tool sets assigned to each specialist category. */
export const CATEGORY_TOOL_SETS: Record<SpecialistCategory, string[]> = {
	chat: [],
	code_edit: [
		'read_file',
		'write_file',
		'string_replace',
		'find_files',
		'search_file_contents',
		'agent',
	],
	code_explore: [
		'read_file',
		'find_files',
		'search_file_contents',
		'list_directory',
		'agent',
	],
	shell: ['execute_bash', 'read_file', 'write_file'],
	git: [
		'git_status',
		'git_diff',
		'git_log',
		'git_add',
		'git_commit',
		'git_push',
		'git_pull',
		'git_branch',
	],
	web: ['web_search', 'fetch_url', 'agent'],
	task: ['create_task', 'list_tasks', 'update_task', 'delete_task'],
	// multi gets the full set — let the model decide
	multi: [],
};

/** Description of each category for the router prompt. */
export const CATEGORY_DESCRIPTIONS: Record<SpecialistCategory, string> = {
	chat: 'Simple conversation, greetings, opinions, discussing ideas, questions answerable from context. Use when the user is TALKING ABOUT a topic, not requesting an action.',
	code_edit:
		'Editing, modifying, refactoring, fixing, or creating code files. The user wants to CHANGE code.',
	code_explore:
		'Reading, searching, understanding, or exploring code. The user wants to UNDERSTAND code without changing it.',
	shell:
		'Running shell commands, building, testing, installing packages, deploying.',
	git: 'Git operations: commit, push, pull, branch, diff, log, status.',
	web: 'Searching the web for information, fetching URLs.',
	task: 'Creating, listing, updating, or completing tasks and to-dos.',
	multi:
		'Complex requests needing multiple different tools or multi-step workflows that do not fit neatly into one category.',
};

/** Categories where sticky routing is allowed (conversation-oriented). */
export const STICKY_CATEGORIES = new Set<SpecialistCategory>([
	'chat',
	'code_explore',
]);

/** Router configuration. */
export interface RouterConfig {
	/** Model to use for classification. Should be a small fast model. */
	model: string;
	/** Timeout in ms for the classification call. */
	timeout: number;
	/** Default category when nothing else matches. */
	defaultCategory: SpecialistCategory;
	/** Per-category descriptions for the router prompt. */
	categories: Partial<Record<SpecialistCategory, string>>;
}

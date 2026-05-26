/**
 * Keyword hint patterns for routing classification fallback.
 *
 * Ordered by specificity — more specific patterns come first to prevent
 * false positives. Adapted from LocalClaw's KEYWORD_HINTS table.
 */

import type {SpecialistCategory} from './types';

export interface KeywordHint {
	pattern: RegExp;
	category: SpecialistCategory;
}

/**
 * Keyword patterns evaluated in order. The first match wins.
 *
 * Design principles from LocalClaw:
 * - Specific action categories (git, exec) before broad ones (web_search)
 * - Compound patterns avoid false positives on casual conversation
 * - "what is" and "who is" are intentionally excluded — they are
 *   questions, not search intent, and break sticky routing for casual chat
 */
export const KEYWORD_HINTS: KeywordHint[] = [
	// ── Git ──────────────────────────────────────────────────────
	{
		pattern:
			/\b(git\s+(commit|push|pull|add|branch|stash|reset|log|diff|status|checkout|merge|rebase))\b/i,
		category: 'git',
	},
	{
		pattern:
			/\b(commit|push|pull|merge|rebase|checkout)\b.*\b(changes|branch|repo|files)\b/i,
		category: 'git',
	},

	// ── Shell ────────────────────────────────────────────────────
	{
		pattern:
			/\b(run|execute|build|test|start|compile|deploy|install)\b.*\b(command|script|code|program|server|docker|container|tests|build)\b/i,
		category: 'shell',
	},
	{
		pattern: /\b(npm|yarn|pnpm|pip|cargo|make|docker|kubectl)\s+\w/i,
		category: 'shell',
	},
	{
		pattern: /\b(list|show|ls)\b.*\b(files|directory|folder|dir)\b/i,
		category: 'shell',
	},

	// ── Task (before code_edit to catch 'add a task to fix') ─────
	{
		pattern:
			/\b(task|todo|to-do|checklist|add task|my tasks|pending|mark done|complete task)\b/i,
		category: 'task',
	},

	// ── Code Edit ────────────────────────────────────────────────
	{
		pattern:
			/\b(fix|refactor|implement|change|update|modify|rename|delete|remove|add|create|write)\b.*\b(in|of|the|a|file|function|class|module|component|method)\b/i,
		category: 'code_edit',
	},
	{
		pattern:
			/\b(fix|debug|resolve|solve)\b.*\b(bug|error|issue|problem|warning)\b/i,
		category: 'code_edit',
	},
	{
		pattern: /\b(edit|modify|update|change)\b.*\b(file|code|source|config)\b/i,
		category: 'code_edit',
	},

	// ── Code Explore ─────────────────────────────────────────────
	{
		pattern:
			/\b(search|find|where|locate|grep)\b.*\b(is|are|defined|implemented|located|used|declared)\b/i,
		category: 'code_explore',
	},
	{
		pattern:
			/\b(what|how|explain|understand|show|tell me)\b.*\b(this|the|code|file|function|class|module|does|works|mean|about)\b/i,
		category: 'code_explore',
	},
	{
		pattern:
			/\b(read|review|analyze|examine|look at|check)\b.*\b(file|code|source|implementation)\b/i,
		category: 'code_explore',
	},
	// File references: "tell me about X.ts", "explain package.json", "what is config.yaml"
	{
		pattern:
			/\b(tell me|explain|show|describe|what is|what's|about)\b.*\.\w+\s*$/i,
		category: 'code_explore',
	},
	{
		pattern:
			/\b(about|in|of|from)\b\s+\S+\.(ts|tsx|js|jsx|json|md|yaml|yml|toml|py|rs|go)\b/i,
		category: 'code_explore',
	},

	// ── Web ──────────────────────────────────────────────────────
	{
		pattern:
			/\b(search\s+(the\s+)?(web|online|internet)|google|look\s+up|find\s+out)\b/i,
		category: 'web',
	},
	{
		pattern:
			/\b(latest|current|recent)\b.*\b(news|information|update|version|release)\b/i,
		category: 'web',
	},
];

/**
 * Pre-model override patterns — high-confidence regex patterns that fire
 * BEFORE model classification. These are very specific to avoid false
 * positives.
 */
export const PRE_MODEL_OVERRIDES: KeywordHint[] = [
	// Shell commands via `!` prefix
	{pattern: /^!/, category: 'shell'},

	// File mentions via `@` prefix → code_edit
	{pattern: /@\S+\.\w+/, category: 'code_edit'},

	// Explicit git commands
	{
		pattern: /\b(git\s+(commit|push|pull|add|branch|stash|reset))\b/i,
		category: 'git',
	},

	// Task management slash commands
	{
		pattern: /\/tasks?\s+(add|remove|clear|list)/i,
		category: 'task',
	},

	// Multi-step compound actions
	{
		pattern:
			/\b(find|search)\b.*\b(and|then)\b.*\b(fix|edit|change|update|refactor)\b/i,
		category: 'multi',
	},
	{
		pattern:
			/\b(search|find|analyze)\b.*\b(and|then)\b.*\b(write|create|implement|build)\b/i,
		category: 'multi',
	},
];

/**
 * Strong new-topic signals — these break sticky routing because they
 * indicate the user is starting a genuinely different task.
 */
export const NEW_TOPIC_PATTERNS: RegExp[] = [
	/\b(search|google|look up)\b.*\b(for|about)\b/i,
	/\b(find|search|look)\b.*(and|then)\b/i,
	/\b(sign.*(up|me)|register|subscribe)\b/i,
	/\b(run|execute|deploy|install|sudo)\b/i,
	/\b(remind me|schedule|every day|set up a cron)\b/i,
	/\b(remember this|save this|store this)\b/i,
	/\b(can you|could you|please)\s+(search|find|look|check|fix|edit|build|create|implement)\b/i,
	/\b(build|create|make|generate|write|scaffold|implement)\b/i,
];

/**
 * Greeting patterns — messages that open with a greeting start a new
 * conversation, not a follow-up.
 */
export const GREETING_PATTERNS: RegExp[] = [
	/^\s*(hi|hey|hello|yo|sup|howdy|hola|what'?s up|how'?s it going|good\s+(morning|afternoon|evening)|thanks|thank you)\b/i,
];

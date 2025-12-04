/**
 * Query Analyzer
 *
 * Analyzes user queries to extract task type and mentioned context.
 */

import type {QueryAnalysis} from './types';

/**
 * Keywords that suggest implementation tasks
 */
const IMPLEMENTATION_KEYWORDS = [
	'create',
	'build',
	'implement',
	'add',
	'make',
	'write',
	'develop',
	'set up',
	'setup',
	'integrate',
	'connect',
];

/**
 * Keywords that suggest debugging tasks
 */
const DEBUGGING_KEYWORDS = [
	'fix',
	'debug',
	'troubleshoot',
	'solve',
	'resolve',
	'error',
	'bug',
	'issue',
	'problem',
	'broken',
	"doesn't work",
	"isn't working",
	'not working',
	'failing',
];

/**
 * Keywords that suggest refactoring tasks
 */
const REFACTORING_KEYWORDS = [
	'refactor',
	'improve',
	'optimize',
	'clean up',
	'cleanup',
	'reorganize',
	'restructure',
	'simplify',
	'extract',
	'rename',
	'move',
];

/**
 * Keywords that suggest research/exploration tasks
 */
const RESEARCH_KEYWORDS = [
	'find',
	'search',
	'look for',
	'where is',
	'locate',
	'show me',
	'list',
	'what is',
	'how does',
	'explain',
	'understand',
	'analyze',
];

/**
 * Keywords that suggest questions (not tasks)
 */
const QUESTION_KEYWORDS = [
	'what is',
	'what are',
	'how do i',
	'how does',
	'why does',
	'can you explain',
	'tell me about',
	'what does',
	'is there',
	'are there',
];

/**
 * Analyze a query to extract task type and context
 */
export function analyzeQuery(query: string): QueryAnalysis {
	const queryLower = query.toLowerCase().trim();

	return {
		taskType: detectTaskType(queryLower),
		requiredContext: extractContextNeeds(queryLower),
	};
}

/**
 * Detect the type of task from the query
 */
function detectTaskType(query: string): QueryAnalysis['taskType'] {
	// Check in order of specificity
	if (containsAny(query, QUESTION_KEYWORDS)) {
		return 'question';
	}
	if (containsAny(query, DEBUGGING_KEYWORDS)) {
		return 'debugging';
	}
	if (containsAny(query, REFACTORING_KEYWORDS)) {
		return 'refactoring';
	}
	if (containsAny(query, IMPLEMENTATION_KEYWORDS)) {
		return 'implementation';
	}
	if (containsAny(query, RESEARCH_KEYWORDS)) {
		return 'research';
	}

	return 'other';
}

/**
 * Extract potential context needs from the query
 */
function extractContextNeeds(query: string): string[] {
	const context: string[] = [];

	// Look for file paths mentioned
	const pathPatterns = [
		/(?:^|\s)([\w./\\-]+\.\w{2,4})(?:\s|$)/g, // file.ext
		/(?:^|\s)(src\/[\w./\\-]+)(?:\s|$)/g, // src/path
		/(?:^|\s)(\.\/[\w./\\-]+)(?:\s|$)/g, // ./path
	];

	for (const pattern of pathPatterns) {
		const matches = query.matchAll(pattern);
		for (const match of matches) {
			if (match[1] && !context.includes(match[1])) {
				context.push(match[1]);
			}
		}
	}

	// Look for component/module names (PascalCase or camelCase)
	const namePattern =
		/\b([A-Z][a-zA-Z0-9]+(?:Component|Service|Provider|Hook|Handler)?)\b/g;
	const nameMatches = query.matchAll(namePattern);
	for (const match of nameMatches) {
		if (match[1] && !context.includes(match[1])) {
			context.push(match[1]);
		}
	}

	return context;
}

/**
 * Helper: check if string contains any of the keywords
 */
function containsAny(str: string, keywords: string[]): boolean {
	return keywords.some(kw => str.includes(kw));
}

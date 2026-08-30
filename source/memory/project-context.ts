import {getLogger} from '@/utils/logging';
import type {SemanticMemory} from './semantic-memory-manager';
import {SemanticMemoryManager} from './semantic-memory-manager';

export type MemoryFinder = Pick<SemanticMemoryManager, 'findRelevantMemories'>;

export interface ProjectContextOptions {
	memoryLimit?: number;
	tokenBudget?: number;
	semanticMemoryEnabled?: boolean;
}

export interface ProjectContextResult {
	systemPrompt: string;
	memoryCount: number;
}

export const DEFAULT_MEMORY_LIMIT = 8;
export const DEFAULT_TOKEN_BUDGET = 240;

/** Bounds for the user-configurable values, applied when preferences are read. */
export const MIN_MEMORY_LIMIT = 1;
export const MAX_MEMORY_LIMIT = 50;
export const MIN_TOKEN_BUDGET = 40;
export const MAX_TOKEN_BUDGET = 4000;

function estimateTokens(value: string): number {
	return Math.ceil(value.length / 4);
}

/**
 * Picks a fence longer than the longest backtick run in the body, the way
 * Markdown itself does. Memory content is interpolated verbatim, so a fixed
 * three-backtick fence could be escaped by a memory containing backticks.
 */
function fenceFor(body: string): string {
	let longest = 0;
	for (const match of body.matchAll(/`+/gu)) {
		longest = Math.max(longest, match[0].length);
	}
	return '`'.repeat(Math.max(3, longest + 1));
}

function formatProjectContextWithCount(
	memories: SemanticMemory[],
	options: ProjectContextOptions = {},
): {content: string; memoryCount: number} {
	if (memories.length === 0) return {content: '', memoryCount: 0};

	const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
	const bullets: string[] = [];
	let usedTokens =
		estimateTokens('## Project Context\n\n') + estimateTokens('```\n\n```');

	for (const memory of memories) {
		const text = memory.content
			.replaceAll(/\s+/gu, ' ')
			.trim()
			.replace(/^[-*]\s+/u, '');
		const bullet = `- ${text}`;
		const bulletTokens = estimateTokens(`${bullet}\n`);
		if (usedTokens + bulletTokens > tokenBudget) continue;

		bullets.push(bullet);
		usedTokens += bulletTokens;
	}

	if (bullets.length === 0) return {content: '', memoryCount: 0};

	const body = bullets.join('\n');
	const fence = fenceFor(body);

	return {
		content: `## Project Context\n\n${fence}\n${body}\n${fence}`,
		memoryCount: bullets.length,
	};
}

export async function appendRelevantProjectContextWithCount(
	systemPrompt: string,
	query: string,
	memoryFinder: MemoryFinder = new SemanticMemoryManager(),
	options: ProjectContextOptions = {},
): Promise<ProjectContextResult> {
	if (options.semanticMemoryEnabled === false) {
		return {systemPrompt, memoryCount: 0};
	}

	try {
		const projectContext = formatProjectContextWithCount(
			await memoryFinder.findRelevantMemories(
				query,
				options.memoryLimit ?? DEFAULT_MEMORY_LIMIT,
			),
			options,
		);

		if (!projectContext.content) return {systemPrompt, memoryCount: 0};

		return {
			systemPrompt: `${systemPrompt}\n\n${projectContext.content}`,
			memoryCount: projectContext.memoryCount,
		};
	} catch (error) {
		getLogger().warn('Failed to recall project memories', {error});
		return {systemPrompt, memoryCount: 0};
	}
}

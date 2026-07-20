import type {SemanticMemory} from './semantic-memory-manager';
import {SemanticMemoryManager} from './semantic-memory-manager';

export type MemoryFinder = Pick<SemanticMemoryManager, 'findRelevantMemories'>;

export interface ProjectContextOptions {
	memoryLimit?: number;
	tokenBudget?: number;
}

const DEFAULT_MEMORY_LIMIT = 8;
const DEFAULT_TOKEN_BUDGET = 240;

function estimateTokens(value: string): number {
	return Math.ceil(value.length / 4);
}

export function formatProjectContext(
	memories: SemanticMemory[],
	options: ProjectContextOptions = {},
): string {
	if (memories.length === 0) return '';

	const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
	const bullets: string[] = [];
	let usedTokens = estimateTokens('## Project Context\n\n');

	for (const memory of memories) {
		const bullet = `- ${memory.content.replaceAll(/\s+/gu, ' ').trim()}`;
		const bulletTokens = estimateTokens(`${bullet}\n`);
		if (usedTokens + bulletTokens > tokenBudget) continue;

		bullets.push(bullet);
		usedTokens += bulletTokens;
	}

	if (bullets.length === 0) return '';

	return `## Project Context\n\n${bullets.join('\n')}`;
}

export function appendProjectContext(
	systemPrompt: string,
	memories: SemanticMemory[],
	options?: ProjectContextOptions,
): string {
	const projectContext = formatProjectContext(memories, options);
	if (!projectContext) return systemPrompt;

	return `${systemPrompt}\n\n${projectContext}`;
}

export async function appendRelevantProjectContext(
	systemPrompt: string,
	query: string,
	memoryFinder: MemoryFinder = new SemanticMemoryManager(),
	options: ProjectContextOptions = {},
): Promise<string> {
	try {
		return appendProjectContext(
			systemPrompt,
			await memoryFinder.findRelevantMemories(
				query,
				options.memoryLimit ?? DEFAULT_MEMORY_LIMIT,
			),
			options,
		);
	} catch {
		return systemPrompt;
	}
}

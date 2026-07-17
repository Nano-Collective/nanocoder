import type {SemanticMemory} from './semantic-memory-manager';
import {SemanticMemoryManager} from './semantic-memory-manager';

type MemoryFinder = Pick<SemanticMemoryManager, 'findRelevantMemories'>;

const PROJECT_CONTEXT_LIMIT = 3;

export function formatProjectContext(memories: SemanticMemory[]): string {
	if (memories.length === 0) return '';

	const bullets = memories.map(
		memory => `- ${memory.content.replaceAll(/\s+/gu, ' ').trim()}`,
	);

	return `## Project Context\n\n${bullets.join('\n')}`;
}

export function appendProjectContext(
	systemPrompt: string,
	memories: SemanticMemory[],
): string {
	const projectContext = formatProjectContext(memories);
	if (!projectContext) return systemPrompt;

	return `${systemPrompt}\n\n${projectContext}`;
}

export async function appendRelevantProjectContext(
	systemPrompt: string,
	query: string,
	memoryFinder: MemoryFinder = new SemanticMemoryManager(),
): Promise<string> {
	try {
		return appendProjectContext(
			systemPrompt,
			await memoryFinder.findRelevantMemories(query, PROJECT_CONTEXT_LIMIT),
		);
	} catch {
		return systemPrompt;
	}
}

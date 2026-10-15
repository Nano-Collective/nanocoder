import {getLogger} from '@/utils/logging';
import type {MemoryFileChange, SemanticMemory} from './semantic-memory-manager';
import {SemanticMemoryManager} from './semantic-memory-manager';

export type MemoryFinder = Pick<SemanticMemoryManager, 'findRelevantMemories'> &
	Partial<Pick<SemanticMemoryManager, 'findChangedFiles'>>;

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

const MAX_LISTED_CHANGED_FILES = 3;

function joinFiles(files: string[]): string {
	const listed = files.slice(0, MAX_LISTED_CHANGED_FILES);
	const hidden = files.length - listed.length;
	return hidden > 0
		? `${listed.join(', ')} and ${hidden} more`
		: listed.join(', ');
}

/** Kept short: it is paid for out of the same token budget as the memories. */
function formatStaleWarning(
	commit: string,
	changes: MemoryFileChange[],
): string {
	const modified = changes
		.filter(change => change.status === 'modified')
		.map(change => change.path);
	const deleted = changes
		.filter(change => change.status === 'deleted')
		.map(change => change.path);
	const clauses = [
		...(modified.length > 0
			? [
					`${joinFiles(modified)} ${modified.length === 1 ? 'has' : 'have'} changed`,
				]
			: []),
		...(deleted.length > 0
			? [
					`${joinFiles(deleted)} ${deleted.length === 1 ? 'has' : 'have'} been deleted`,
				]
			: []),
	];
	return `[WARNING: recorded at ${commit.slice(0, 7)}, ${clauses.join(' and ')} since. Verify before trusting.]`;
}

/**
 * Staleness is advisory: if git cannot answer, memories are injected exactly
 * as they were before the check existed.
 */
async function findChangedFiles(
	memoryFinder: MemoryFinder,
	memories: SemanticMemory[],
): Promise<Map<string, MemoryFileChange[]>> {
	if (!memoryFinder.findChangedFiles || memories.length === 0) {
		return new Map();
	}
	try {
		return await memoryFinder.findChangedFiles(memories);
	} catch (error) {
		getLogger().warn({error}, 'Failed to check project memory freshness');
		return new Map();
	}
}

function formatProjectContextWithCount(
	memories: SemanticMemory[],
	options: ProjectContextOptions = {},
	changedFiles: Map<string, MemoryFileChange[]> = new Map(),
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
		const changes = changedFiles.get(memory.id);
		const warning =
			changes && memory.git
				? `${formatStaleWarning(memory.git.commit, changes)} `
				: '';
		const bullet = `- ${warning}${text}`;
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
		const memories = await memoryFinder.findRelevantMemories(
			query,
			options.memoryLimit ?? DEFAULT_MEMORY_LIMIT,
		);
		const projectContext = formatProjectContextWithCount(
			memories,
			options,
			await findChangedFiles(memoryFinder, memories),
		);

		if (!projectContext.content) return {systemPrompt, memoryCount: 0};

		return {
			systemPrompt: `${systemPrompt}\n\n${projectContext.content}`,
			memoryCount: projectContext.memoryCount,
		};
	} catch (error) {
		getLogger().warn({error}, 'Failed to recall project memories');
		return {systemPrompt, memoryCount: 0};
	}
}

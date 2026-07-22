import type {Message} from '@/types/core';
import {
	type SemanticMemory,
	SemanticMemoryManager,
} from './semantic-memory-manager';

export interface RememberMemoryInput {
	content: string;
	category?: string;
	sourceSessionId?: string;
}

export interface MemoryProposal {
	content: string;
	category: string;
}

const CATEGORY_RULES: Array<{category: string; pattern: RegExp}> = [
	{
		category: 'bugFix',
		pattern: /\b(bug|fix|fixed|regression|failure|failed|failing|flake)\b/i,
	},
	{
		category: 'refactor',
		pattern: /\b(refactor|migration|migrate|migrated|rewrite)\b/i,
	},
	{
		category: 'todo',
		pattern: /\b(todo|follow up|later|defer|deferred|unresolved)\b/i,
	},
	{
		category: 'architecture',
		pattern:
			/\b(architecture|architectural|adapter|middleware|provider|database|storage|schema|abstraction)\b/i,
	},
	{
		category: 'codingStyle',
		pattern: /\b(style|convention|format|formatting|naming|camel case|lint)\b/i,
	},
];

export class SummarizerService {
	constructor(private readonly memoryManager = new SemanticMemoryManager()) {}

	async remember(input: RememberMemoryInput): Promise<SemanticMemory> {
		const content = input.content.trim();
		if (!content) {
			throw new Error('Memory content cannot be empty');
		}

		return this.memoryManager.addMemory({
			content,
			category: input.category
				? toCamelCaseCategory(input.category)
				: inferMemoryCategory(content),
			sourceSessionId: input.sourceSessionId,
		});
	}

	proposeMemoriesFromMessages(messages: Message[]): MemoryProposal[] {
		const proposals = new Map<string, MemoryProposal>();

		for (const message of messages) {
			if (message.role !== 'user' && message.role !== 'assistant') continue;

			for (const candidate of splitMemoryCandidates(message.content)) {
				const category = inferMemoryCategory(candidate);
				if (category === 'project') continue;

				const key = candidate.toLowerCase();
				if (!proposals.has(key)) {
					proposals.set(key, {content: candidate, category});
				}
			}
		}

		return [...proposals.values()];
	}
}

export function inferMemoryCategory(content: string): string {
	for (const rule of CATEGORY_RULES) {
		if (rule.pattern.test(content)) return rule.category;
	}

	return 'project';
}

export function toCamelCaseCategory(value: string): string {
	const parts = value
		.trim()
		.toLowerCase()
		.split(/[^a-z0-9]+/u)
		.filter(Boolean);

	if (parts.length === 0) return 'project';

	return parts
		.map((part, index) =>
			index === 0 ? part : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`,
		)
		.join('');
}

function splitMemoryCandidates(content: string): string[] {
	return content
		.split(/\n+/u)
		.map(part => part.trim())
		.filter(part => part.length >= 12 && part.length <= 300);
}

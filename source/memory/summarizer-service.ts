import {getSemanticMemoryEnabled} from '@/config/preferences';
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

export type MemorySourceType = 'explicit-user' | 'conversation-inferred';

export interface MemoryProposal {
	content: string;
	category: string;
	sourceType: MemorySourceType;
	evidence: {
		userMessages: string[];
		assistantMessages: string[];
	};
	warnings: string[];
}

const MAX_CANDIDATES_PER_MESSAGE = 3;
const MAX_EVIDENCE_LENGTH = 160;

function truncateEvidence(content: string): string {
	const collapsed = content.replaceAll(/\s+/gu, ' ').trim();
	if (collapsed.length <= MAX_EVIDENCE_LENGTH) return collapsed;
	return `${collapsed.slice(0, MAX_EVIDENCE_LENGTH)}…`;
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
		pattern:
			/\b(style|convention|format|formatting|naming|camel ?case|lint)\b/i,
	},
];

export class SummarizerService {
	constructor(
		private readonly memoryManager = new SemanticMemoryManager(),
		private readonly isMemoryEnabled: () => boolean = getSemanticMemoryEnabled,
	) {}

	async remember(input: RememberMemoryInput): Promise<SemanticMemory> {
		this.assertMemoryWritesEnabled();

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

	async acceptProposal(
		proposal: Pick<MemoryProposal, 'content' | 'category'>,
		sourceSessionId?: string,
	): Promise<SemanticMemory> {
		this.assertMemoryWritesEnabled();

		return this.memoryManager.addMemory({
			content: proposal.content,
			category: proposal.category,
			sourceSessionId,
		});
	}

	private assertMemoryWritesEnabled(): void {
		if (!this.isMemoryEnabled()) {
			throw new Error(
				'Semantic memory is turned off. Enable it in /settings to save memories.',
			);
		}
	}

	proposeMemoriesFromMessages(messages: Message[]): MemoryProposal[] {
		const proposals = new Map<
			string,
			{
				content: string;
				category: string;
				sourceRole: 'user' | 'assistant';
				userTurns: string[];
				assistantTurns: string[];
				warnings: string[];
			}
		>();

		for (let i = 0; i < messages.length; i++) {
			const message = messages[i];
			if (!message || (message.role !== 'user' && message.role !== 'assistant'))
				continue;

			const candidates = splitMemoryCandidates(message.content).slice(
				0,
				MAX_CANDIDATES_PER_MESSAGE,
			);

			for (const candidate of candidates) {
				const category = inferMemoryCategory(candidate);
				if (category === 'project' && message.role === 'assistant') continue;

				const key = candidate.toLowerCase();
				if (!proposals.has(key)) {
					proposals.set(key, {
						content: candidate,
						category,
						sourceRole: message.role,
						userTurns: [],
						assistantTurns: [],
						warnings: [],
					});
				}

				const entry = proposals.get(key)!;
				const snippet = truncateEvidence(message.content);
				if (message.role === 'user') {
					entry.userTurns.push(snippet);
					entry.sourceRole = 'user';
					entry.warnings = entry.warnings.filter(
						warning => warning !== 'Possible assistant position reversal.',
					);
				} else {
					entry.assistantTurns.push(snippet);
				}

				if (message.role === 'assistant' && entry.sourceRole !== 'user') {
					if (this.isAssistantReversal(messages, i)) {
						if (
							!entry.warnings.includes('Possible assistant position reversal.')
						) {
							entry.warnings.push('Possible assistant position reversal.');
						}
					}
				}
			}
		}

		return [...proposals.values()].map(entry => {
			const sourceType: MemorySourceType =
				entry.sourceRole === 'user' ? 'explicit-user' : 'conversation-inferred';
			const warnings = [...entry.warnings];

			if (sourceType === 'conversation-inferred') {
				if (
					!warnings.includes(
						'Inferred from conversation, no explicit user statement.',
					)
				) {
					warnings.push(
						'Inferred from conversation, no explicit user statement.',
					);
				}
			}

			return {
				content: entry.content,
				category: entry.category,
				sourceType,
				evidence: {
					userMessages: entry.userTurns,
					assistantMessages: entry.assistantTurns,
				},
				warnings,
			};
		});
	}

	private isAssistantReversal(
		messages: Message[],
		assistantIndex: number,
	): boolean {
		const assistantMsg = messages[assistantIndex];
		if (!assistantMsg) return false;

		const agreementOpenerPattern =
			/^\s*[^a-z0-9]*(you're right|good point|fair enough|that makes sense|you're correct|fair point)/i;
		if (!agreementOpenerPattern.test(assistantMsg.content)) {
			return false;
		}

		let userMsg: Message | undefined;
		for (let i = assistantIndex - 1; i >= 0; i--) {
			const m = messages[i];
			if (!m) continue;
			if (m.role === 'user') {
				userMsg = m;
				break;
			}
			if (m.role === 'assistant') {
				return false;
			}
		}

		if (!userMsg) return false;

		const userContent = userMsg.content;
		const hasCodeBlock = /```/.test(userContent);
		const hasFilePath = /[/]|\.(ts|js|jsx|tsx|py|json|md|html|css)\b/i.test(
			userContent,
		);
		const hasErrorOutput = /\b(error:|exception|traceback|stack trace)\b/i.test(
			userContent,
		);

		return !(hasCodeBlock || hasFilePath || hasErrorOutput);
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
		.filter(
			part => part.length >= 12 && part.length <= 300 && !part.endsWith('?'),
		);
}

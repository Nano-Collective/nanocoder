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

/**
 * How far back `/memory propose` scans. Proposals are reviewed by eye against a
 * printed, numbered list, so an unbounded scan over a long session produces a
 * list nobody reads. Both limits keep the newest turns.
 */
export const MAX_SCANNED_MESSAGES = 40;
export const MAX_PROPOSALS = 20;

export const REVERSAL_WARNING = 'Possible assistant position reversal.';
const INFERRED_WARNING =
	'Inferred from conversation, no explicit user statement.';

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

/**
 * Openers a model reaches for when conceding. Deliberately broader than a
 * handful of stock phrases: a concession phrased "Agreed on reflection" is the
 * same event as one phrased "You're right", and only one of them was previously
 * detectable.
 */
const AGREEMENT_OPENER_PATTERN =
	/^\s*[^a-z0-9]*(you(?:'|’)?re\s+(?:right|correct)|you\s+are\s+(?:right|correct)|good\s+point|fair\s+(?:enough|point)|that\s+makes\s+sense|agreed|i\s+agree|on\s+reflection|point\s+taken|my\s+mistake|i\s+was\s+wrong|apologies|sorry,\s+you)/i;

/**
 * Signals that a user turn carried real evidence rather than bare preference.
 *
 * A path needs a genuine path shape - a leading `/`, `./` or `~/`, two or more
 * segments, or a known file extension. A single bare slash does not count, so
 * ordinary prose like "auth/login" no longer suppresses detection.
 */
const CODE_FENCE_PATTERN = /```|~~~/;
const INLINE_CODE_PATTERN = /`[^`]+`/;
const PATH_PATTERN =
	/(?:^|[\s('"])(?:~\/|\.{1,2}\/|\/)[\w.-]+|[\w.-]+\/[\w.-]+\/[\w.-]+|\b[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|ya?ml|md|py|rb|go|rs|java|html|css|scss|toml|sh|sql)\b/;
const ERROR_OUTPUT_PATTERN =
	/\b(error:|exception|traceback|stack\s?trace|failed\s+with|exit\s+code|ENOENT|undefined is not|cannot read)\b/i;
const CODE_IDENTIFIER_PATTERN =
	/\b[A-Za-z_$][\w$]*\([^)]*\)|\b[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]+\b/;

function hasTechnicalEvidence(content: string): boolean {
	return (
		CODE_FENCE_PATTERN.test(content) ||
		INLINE_CODE_PATTERN.test(content) ||
		PATH_PATTERN.test(content) ||
		ERROR_OUTPUT_PATTERN.test(content) ||
		CODE_IDENTIFIER_PATTERN.test(content)
	);
}

const LOOKAHEAD_NARRATION =
	/^(?:let me |i(?:'m going to |'ll | will )?)(?:re-)?(?:read|look at|check|inspect|open|examine)\b/i;

/** Tool calls (with or without narration) and "I'll look at the file" turns. */
function isPlumbingTurn(message: Message): boolean {
	if ((message.tool_calls?.length ?? 0) > 0) return true;
	return LOOKAHEAD_NARRATION.test(message.content.trim());
}

const NEGATION_PATTERN =
	/\b(not|never|no|avoid|isn'?t|aren'?t|won'?t|shouldn'?t|doesn'?t|don'?t|instead\s+of|rather\s+than|no\s+longer)\b/i;

/**
 * Opposed term pairs used to spot a stance flip between two assistant turns.
 * Each entry is one axis; which side a turn *asserts* is decided by whether the
 * term is negated, so "lazily, not eagerly" asserts lazy rather than both.
 */
const OPPOSED_TERM_PAIRS: Array<[RegExp, RegExp]> = [
	[/\blazil?y?\b|\blazy\b/i, /\beager(?:ly)?\b/i],
	[/\bsynchronous(?:ly)?\b|\bsync\b/i, /\basynchronous(?:ly)?\b|\basync\b/i],
	[/\benabled?\b/i, /\bdisabled?\b/i],
	[/\bincluded?\b/i, /\bexcluded?\b/i],
	[/\badded?\b/i, /\bremoved?\b/i],
	[/\bmutable\b/i, /\bimmutable\b/i],
	[/\bexplicit(?:ly)?\b/i, /\bimplicit(?:ly)?\b/i],
	[/\bstatic(?:ally)?\b/i, /\bdynamic(?:ally)?\b/i],
	[/\bbefore\b/i, /\bafter\b/i],
	[/\bsingle\b/i, /\bmultiple\b/i],
	[/\bshould\b/i, /\bshould\s?n[o']?t\b/i],
];

const NEGATION_LOOKBEHIND = 24;

/** True when `pattern` matches `text` at a position not preceded by a negation. */
function assertsTerm(text: string, pattern: RegExp): boolean {
	const global = new RegExp(
		pattern.source,
		`${pattern.flags.replace('g', '')}g`,
	);
	for (const match of text.matchAll(global)) {
		const start = match.index ?? 0;
		const preceding = text.slice(
			Math.max(0, start - NEGATION_LOOKBEHIND),
			start,
		);
		if (!NEGATION_PATTERN.test(preceding)) return true;
	}
	return false;
}

function contentTerms(value: string): Set<string> {
	return new Set(
		value
			.toLowerCase()
			.split(/[^a-z0-9]+/u)
			.filter(part => part.length > 2 && !TOPIC_STOPWORDS.has(part)),
	);
}

const TOPIC_STOPWORDS = new Set([
	'the',
	'and',
	'but',
	'for',
	'not',
	'you',
	'are',
	'was',
	'were',
	'this',
	'that',
	'with',
	'have',
	'has',
	'had',
	'will',
	'would',
	'should',
	'could',
	'can',
	'its',
	'your',
	'our',
	'their',
	'them',
	'they',
	'from',
	'into',
	'been',
	'right',
	'correct',
	'agreed',
	'agree',
	'point',
	'sense',
	'makes',
	'reflection',
]);

const MIN_SHARED_TOPIC_TERMS = 2;

/**
 * True when `later` reverses a stance `earlier` took on the same subject.
 *
 * Requires topical overlap first, then either a flip along one of the opposed
 * term axes or a negation asymmetry on a shared term. This is a heuristic
 * feeding a *warning* on a proposal the user is already reviewing by hand, so it
 * is tuned to tolerate false positives rather than miss real concessions.
 */
function isContradiction(earlier: string, later: string): boolean {
	const earlierTerms = contentTerms(earlier);
	const laterTerms = contentTerms(later);
	const shared = [...laterTerms].filter(term => earlierTerms.has(term));
	if (shared.length < MIN_SHARED_TOPIC_TERMS) return false;

	for (const [sideA, sideB] of OPPOSED_TERM_PAIRS) {
		const earlierA = assertsTerm(earlier, sideA);
		const earlierB = assertsTerm(earlier, sideB);
		const laterA = assertsTerm(later, sideA);
		const laterB = assertsTerm(later, sideB);
		if (
			(earlierA && !earlierB && laterB && !laterA) ||
			(earlierB && !earlierA && laterA && !laterB)
		) {
			return true;
		}
	}

	return shared.some(term => {
		const pattern = new RegExp(`\\b${term}\\b`, 'i');
		return assertsTerm(earlier, pattern) !== assertsTerm(later, pattern);
	});
}

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

		// Only the most recent turns are scanned; older ones would swell the
		// printed list past what anyone reviews by eye.
		const firstScanned = Math.max(0, messages.length - MAX_SCANNED_MESSAGES);

		for (let i = firstScanned; i < messages.length; i++) {
			const message = messages[i];
			if (!message || (message.role !== 'user' && message.role !== 'assistant'))
				continue;

			const candidates = splitMemoryCandidates(message.content).slice(
				0,
				MAX_CANDIDATES_PER_MESSAGE,
			);

			for (const candidate of candidates) {
				const category = inferMemoryCategory(candidate);
				if (category === 'project') continue;

				const key = candidate.toLowerCase();
				let entry = proposals.get(key);
				if (!entry) {
					entry = {
						content: candidate,
						category,
						sourceRole: message.role,
						userTurns: [],
						assistantTurns: [],
						warnings: [],
					};
					proposals.set(key, entry);
				}

				const snippet = truncateEvidence(message.content);
				if (message.role === 'user') {
					entry.userTurns.push(snippet);
					entry.sourceRole = 'user';
					entry.warnings = entry.warnings.filter(
						warning => warning !== REVERSAL_WARNING,
					);
				} else {
					entry.assistantTurns.push(snippet);
				}

				if (
					message.role === 'assistant' &&
					entry.sourceRole !== 'user' &&
					!entry.warnings.includes(REVERSAL_WARNING) &&
					this.isAssistantReversal(messages, i)
				) {
					entry.warnings.push(REVERSAL_WARNING);
				}
			}
		}

		return [...proposals.values()].slice(-MAX_PROPOSALS).map(entry => {
			const sourceType: MemorySourceType =
				entry.sourceRole === 'user' ? 'explicit-user' : 'conversation-inferred';
			const warnings = [...entry.warnings];

			if (
				sourceType === 'conversation-inferred' &&
				!warnings.includes(INFERRED_WARNING)
			) {
				warnings.push(INFERRED_WARNING);
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

	/**
	 * Flags an assistant turn that reads as a concession to social pressure
	 * rather than to evidence.
	 *
	 * Shape, following the original report:
	 *   1. the turn is preceded by a user turn carrying no code, path or error
	 *      output - i.e. pushback with no new information, and
	 *   2. the turn either contradicts an earlier assistant turn on the same
	 *      subject, or opens with an agreement phrase.
	 *
	 * Tool-call turns and tool results are stepped over in (1); in a real
	 * agentic session the assistant reads files between almost every pair of
	 * user turns, and bailing on those made the check near-unreachable.
	 */
	private isAssistantReversal(
		messages: Message[],
		assistantIndex: number,
	): boolean {
		const assistantMsg = messages[assistantIndex];
		if (!assistantMsg) return false;

		let userIndex = -1;
		for (let i = assistantIndex - 1; i >= 0; i--) {
			const m = messages[i];
			if (!m) continue;
			if (m.role === 'tool') continue;
			if (m.role === 'assistant') {
				if (isPlumbingTurn(m)) continue;
				return false;
			}
			if (m.role === 'user') {
				userIndex = i;
				break;
			}
		}

		const userMsg = userIndex >= 0 ? messages[userIndex] : undefined;
		if (!userMsg) return false;
		if (hasTechnicalEvidence(userMsg.content)) return false;

		if (AGREEMENT_OPENER_PATTERN.test(assistantMsg.content)) return true;

		return this.contradictsEarlierAssistantTurn(
			messages,
			assistantIndex,
			userIndex,
		);
	}

	/** True when any assistant turn before `userIndex` took the opposite stance. */
	private contradictsEarlierAssistantTurn(
		messages: Message[],
		assistantIndex: number,
		userIndex: number,
	): boolean {
		const later = messages[assistantIndex];
		if (!later) return false;

		for (let i = userIndex - 1; i >= 0; i--) {
			const earlier = messages[i];
			if (!earlier || earlier.role !== 'assistant') continue;
			if (isPlumbingTurn(earlier)) continue;
			if (isContradiction(earlier.content, later.content)) return true;
		}

		return false;
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
		.map(part =>
			part
				.trim()
				.replace(/^[-*]\s+/u, '')
				.replace(/^\d+\.\s+/u, ''),
		)
		.filter(
			part =>
				part.length >= 12 &&
				part.length <= 300 &&
				!part.endsWith('?') &&
				/[.!:]$/u.test(part),
		);
}

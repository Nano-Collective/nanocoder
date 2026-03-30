/**
 * Auto-Delegation Logic
 *
 * Determines when to automatically delegate tasks to subagents
 * based on user message patterns and keywords.
 */

import type {SubagentConfigWithSource} from './types.js';

/**
 * Result of auto-delegation analysis.
 */
export interface AutoDelegateResult {
	/** Whether delegation should occur */
	shouldDelegate: boolean;
	/** Which subagent to delegate to */
	subagent?: string;
	/** Reason for delegation (for logging/debugging) */
	reason?: string;
	/** Confidence score (0-1) */
	confidence: number;
}

/**
 * AutoDelegator analyzes user messages to determine if they should
 * be delegated to specialized subagents.
 */
export class AutoDelegator {
	/** Available subagents for delegation */
	private availableSubagents: Map<string, SubagentConfigWithSource>;

	/**
	 * Create a new AutoDelegator.
	 * @param availableSubagents - Map of available subagents
	 */
	constructor(availableSubagents: Map<string, SubagentConfigWithSource>) {
		this.availableSubagents = availableSubagents;
	}

	/**
	 * Determine if a user message should be delegated to a subagent.
	 * @param userMessage - The user's message
	 * @returns Auto-delegation decision with reasoning
	 */
	shouldDelegate(userMessage: string): AutoDelegateResult {
		const message = userMessage.toLowerCase().trim();

		// Track the best match across all subagents
		let bestMatch: AutoDelegateResult = {
			shouldDelegate: false,
			confidence: 0,
		};

		// Check each available subagent and find the best match
		for (const [name, config] of this.availableSubagents) {
			const match = this.checkSubagentMatch(message, name, config);
			if (match.shouldDelegate && match.confidence > bestMatch.confidence) {
				bestMatch = match;
			}
		}

		return bestMatch;
	}

	/**
	 * Check if a message matches a specific subagent's delegation criteria.
	 * @param message - The user's message (lowercased)
	 * @param subagentName - Name of the subagent
	 * @param config - Subagent configuration
	 * @returns Match result with confidence score
	 */
	private checkSubagentMatch(
		message: string,
		subagentName: string,
		config: SubagentConfigWithSource,
	): AutoDelegateResult {
		let score = 0;
		let maxScore = 0;
		const reasons: string[] = [];

		// Built-in subagents have specific patterns
		if (config.source.isBuiltIn) {
			if (subagentName === 'explore') {
				// Exploration keywords and patterns
				const exploreKeywords = [
					'find',
					'search',
					'locate',
					'discover',
					'where is',
					'list files',
					'list all',
					'show me all',
					'what files',
					'which files',
				];
				const explorePatterns = [
					/find all .+/i,
					/search for .+/i,
					/locate .+/i,
					/where (is|are) .+/i,
					/list (all )?.files/i,
					/show me (all )?(the )?files/i,
				];

				for (const keyword of exploreKeywords) {
					if (message.includes(keyword)) {
						score += 10;
						reasons.push(`Contains explore keyword: "${keyword}"`);
						break;
					}
				}

				for (const pattern of explorePatterns) {
					if (pattern.test(message)) {
						score += 15;
						reasons.push(`Matches explore pattern`);
						break;
					}
				}

				maxScore = 25;
			} else if (subagentName === 'plan') {
				// Planning keywords and patterns
				const planKeywords = ['plan', 'design', 'architecture', 'approach'];
				const planPatterns = [
					/how should i implement/i,
					/what'?s the (best )?approach/i,
					/help me plan/i,
					/design a .+/i,
				];

				for (const keyword of planKeywords) {
					if (message.includes(keyword)) {
						score += 10;
						reasons.push(`Contains plan keyword: "${keyword}"`);
					}
				}

				for (const pattern of planPatterns) {
					if (pattern.test(message)) {
						score += 15;
						reasons.push(`Matches plan pattern`);
					}
				}

				maxScore = 40; // Planning is more specific, so higher threshold
			}
		} else {
			// Custom subagents - check description for keywords
			const descriptionWords = config.description.toLowerCase().split(/\s+/);
			const messageWords = message.split(/\s+/);

			// Count matching words
			const matches = descriptionWords.filter(
				word => messageWords.includes(word) && word.length > 3, // Only significant words
			);

			if (matches.length >= 2) {
				score = matches.length * 10;
				reasons.push(
					`Matches custom agent keywords: ${matches.slice(0, 3).join(', ')}`,
				);
			}

			maxScore = 30;
		}

		// Require at least 40% confidence for delegation
		const confidence = maxScore > 0 ? score / maxScore : 0;
		const shouldDelegate = score >= 10 && confidence >= 0.4;

		return {
			shouldDelegate,
			subagent: shouldDelegate ? subagentName : undefined,
			reason: shouldDelegate ? reasons.join('; ') : undefined,
			confidence,
		};
	}
}

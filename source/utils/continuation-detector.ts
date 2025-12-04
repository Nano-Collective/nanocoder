/**
 * Continuation Detector
 *
 * Detects when an LLM's response indicates it intends to continue working
 * but hasn't made any tool calls. This is common with local LLMs that output
 * intermediate commentary like "Let me check..." without accompanying tool calls.
 */

export interface ContinuationPatterns {
	/** Phrases that start a continuation (e.g., "Let me...", "I'll...") */
	startingPhrases: string[];
	/** Phrases that indicate conclusion (e.g., "In summary...", "To conclude...") */
	conclusivePhrases: string[];
	/** Action verbs related to tool usage (e.g., "check", "examine", "read") */
	actionVerbs: string[];
	/** Minimum text length to consider for continuation detection */
	minLength: number;
	/** Maximum text length - very long responses are likely complete */
	maxLength: number;
}

export const DEFAULT_CONTINUATION_PATTERNS: ContinuationPatterns = {
	startingPhrases: [
		'let me',
		"i'll",
		'i will',
		'now let me',
		"now i'll",
		"now i will",
		'next, i',
		'next i',
		'first, i',
		'first i',
		'going to',
		'i need to',
	],
	conclusivePhrases: [
		'based on my analysis',
		'in summary',
		'to summarize',
		'to conclude',
		'in conclusion',
		'to answer your question',
		'to answer the question',
		'here is the answer',
		'here are the results',
		'the solution is',
		'this completes',
		'i have completed',
		'task completed',
		'done',
		'finished',
	],
	actionVerbs: [
		'check',
		'examine',
		'search',
		'read',
		'look at',
		'inspect',
		'investigate',
		'explore',
		'analyze',
		'review',
		'find',
		'locate',
		'identify',
	],
	minLength: 10,
	maxLength: 1000,
};

export interface ContinuationDetectionResult {
	/** Whether the response appears to be a continuation */
	shouldContinue: boolean;
	/** Confidence score (0-1) */
	confidence: number;
	/** Detected patterns that influenced the decision */
	detectedPatterns: string[];
	/** Reason for the decision */
	reason: string;
}

/**
 * Detects if a model's response indicates it intends to continue
 * but hasn't made any tool calls.
 *
 * @param text The text content from the model's response
 * @param hadRecentToolResults Whether the previous message was a tool result
 * @param patterns Custom patterns to use (optional, uses defaults if not provided)
 * @returns Detection result with continuation recommendation
 */
export function detectContinuationIntent(
	text: string,
	hadRecentToolResults: boolean,
	patterns: ContinuationPatterns = DEFAULT_CONTINUATION_PATTERNS,
): ContinuationDetectionResult {
	const trimmedText = text.trim();
	const lowerText = trimmedText.toLowerCase();

	// Empty or very short responses - likely not intentional
	if (trimmedText.length < patterns.minLength) {
		return {
			shouldContinue: false,
			confidence: 0,
			detectedPatterns: [],
			reason: 'Response too short',
		};
	}

	// Very long responses - likely complete
	if (trimmedText.length > patterns.maxLength) {
		return {
			shouldContinue: false,
			confidence: 0,
			detectedPatterns: [],
			reason: 'Response too long (likely complete)',
		};
	}

	const detectedPatterns: string[] = [];
	let score = 0;

	// Check for conclusive phrases (strong signal to NOT continue)
	const hasConclusivePhrase = patterns.conclusivePhrases.some(phrase => {
		if (lowerText.includes(phrase)) {
			detectedPatterns.push(`conclusive: "${phrase}"`);
			return true;
		}
		return false;
	});

	if (hasConclusivePhrase) {
		score -= 0.6;
	}

	// Check for starting phrases (strong signal to continue)
	const hasStartingPhrase = patterns.startingPhrases.some(phrase => {
		if (lowerText.startsWith(phrase)) {
			detectedPatterns.push(`starting: "${phrase}"`);
			return true;
		}
		return false;
	});

	if (hasStartingPhrase) {
		score += 0.5;
	}

	// Check for action verbs (moderate signal to continue)
	const actionVerbCount = patterns.actionVerbs.filter(verb => {
		if (lowerText.includes(verb)) {
			detectedPatterns.push(`action: "${verb}"`);
			return true;
		}
		return false;
	}).length;

	if (actionVerbCount > 0) {
		score += Math.min(actionVerbCount * 0.15, 0.3); // Max 0.3 from action verbs
	}

	// Boost score if we just got tool results (model should respond to them)
	if (hadRecentToolResults) {
		score += 0.3;
		detectedPatterns.push('recent tool results');
	}

	// Check if response ends with a colon (often indicates more to come)
	if (trimmedText.endsWith(':')) {
		score += 0.2;
		detectedPatterns.push('ends with colon');
	}

	// Check if response ends with ellipsis (indicates continuation)
	if (trimmedText.endsWith('...')) {
		score += 0.2;
		detectedPatterns.push('ends with ellipsis');
	}

	// Check for question marks (asking questions suggests waiting for response)
	if (lowerText.includes('?')) {
		score -= 0.2;
		detectedPatterns.push('contains question');
	}

	// Normalize score to 0-1 range
	const confidence = Math.max(0, Math.min(1, score));

	// Decision threshold: 0.4 confidence or higher means continue
	const shouldContinue = confidence >= 0.4;

	const reason = shouldContinue
		? `Detected continuation intent (confidence: ${confidence.toFixed(2)})`
		: `No clear continuation intent (confidence: ${confidence.toFixed(2)})`;

	return {
		shouldContinue,
		confidence,
		detectedPatterns,
		reason,
	};
}

/**
 * Configuration for auto-continuation behavior
 */
export type AutoContinuationMode = 'always' | 'smart' | 'never';

/**
 * Determines if auto-continuation should occur based on the mode and detection result
 *
 * @param mode The auto-continuation mode setting
 * @param detectionResult The result from continuation detection
 * @returns Whether to auto-continue
 */
export function shouldAutoContinue(
	mode: AutoContinuationMode,
	detectionResult: ContinuationDetectionResult,
): boolean {
	switch (mode) {
		case 'always':
			return true;
		case 'smart':
			return detectionResult.shouldContinue;
		case 'never':
			return false;
		default:
			return false;
	}
}

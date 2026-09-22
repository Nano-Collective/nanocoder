/**
 * Review tier parsing. `/review` runs the agentic pipeline, `/review quick`
 * the one-shot model pass, `/review deep` the multi-finder pipeline. The
 * tier word is optional and always the first argument when present.
 */

export type ReviewTier = 'default' | 'quick' | 'deep';

export interface ParsedReviewArgs {
	tier: ReviewTier;
	/** Remaining arguments, e.g. the branch or PR number. */
	args: string[];
	/** Present when the tier word was unknown. */
	error?: string;
}

export function parseReviewArgs(args: string[]): ParsedReviewArgs {
	const [first, ...rest] = args;
	const word = first?.toLowerCase();

	if (word === 'quick') {
		return {tier: 'quick', args: rest};
	}
	if (word === 'deep') {
		return {tier: 'deep', args: rest};
	}
	if (word === 'default') {
		return {tier: 'default', args: rest};
	}
	// Not a tier word — but could a user have meant it as one?
	if (word && word !== 'quick' && word !== 'deep' && word !== 'default') {
		// Any non-tier first argument is a target, so default tier.
		return {tier: 'default', args};
	}
	return {tier: 'default', args};
}

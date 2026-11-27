/** One specialist perspective used by `/review deep`. */
export interface FinderLens {
	id: string;
	label: string;
	/** Appended to the finder prompt so this run looks for one class of issue. */
	focus: string;
}

export const FINDER_LENSES: readonly FinderLens[] = [
	{
		id: 'bugs',
		label: 'bugs',
		focus:
			'Focus on correctness bugs: logic errors, broken edge cases, race conditions, error-handling gaps, and security vulnerabilities.',
	},
	{
		id: 'standards',
		label: 'standards and API misuse',
		focus:
			'Focus on standards and API misuse: deprecated or misused APIs, type-safety violations, resource leaks, missing cleanup, and violations of patterns the surrounding code follows.',
	},
	{
		id: 'spec',
		label: 'intent and spec',
		focus:
			'Focus on intent: does the change do what it claims, are there implicit behaviours or callers the change breaks, and are there missing pieces (unused parameters, dead code paths, incomplete migrations) that suggest the change is unfinished?',
	},
];

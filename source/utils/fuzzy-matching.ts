/**
 * Fuzzy match scoring algorithm
 * Returns a score from 0 to 1000 (higher = better match)
 *
 * This can be used for matching file paths, command names, or any other strings.
 */
export function fuzzyScore(text: string, query: string): number {
	if (!query) {
		return 0;
	}

	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();

	// Exact match (highest score)
	if (lowerText === lowerQuery) {
		return 1000;
	}

	// Text starts with query (prefix match - prioritized for command completion)
	if (lowerText.startsWith(lowerQuery)) {
		return 850;
	}

	// Text ends with query (suffix match)
	if (lowerText.endsWith(lowerQuery)) {
		return 800;
	}

	// Text contains query as substring
	if (lowerText.includes(lowerQuery)) {
		return 700;
	}

	// Sequential character match (fuzzy)
	// All query characters appear in order in the text
	let textIndex = 0;
	let queryIndex = 0;
	let lastMatchIndex = -1;
	let consecutiveMatches = 0;

	while (textIndex < lowerText.length && queryIndex < lowerQuery.length) {
		if (lowerText[textIndex] === lowerQuery[queryIndex]) {
			// Bonus for consecutive matches
			if (textIndex === lastMatchIndex + 1) {
				consecutiveMatches++;
			} else {
				consecutiveMatches = 1;
			}
			lastMatchIndex = textIndex;
			queryIndex++;
		}
		textIndex++;
	}

	// If all query characters matched
	if (queryIndex === lowerQuery.length) {
		// Score based on match density and consecutive matches
		const matchDensity = lowerQuery.length / lowerText.length;
		const consecutiveBonus = consecutiveMatches * 50;
		return Math.min(500 + matchDensity * 100 + consecutiveBonus, 699);
	}

	// No match
	return 0;
}

/**
 * Fuzzy score specifically for file paths
 * Gives higher priority to filename matches over directory matches
 */
export function fuzzyScoreFilePath(filePath: string, query: string): number {
	if (!query) {
		return 0;
	}

	const lowerPath = filePath.toLowerCase();
	const lowerQuery = query.toLowerCase();

	// Exact match (highest score)
	if (lowerPath === lowerQuery) {
		return 1000;
	}

	// Exact match of filename (without path)
	const filename = filePath.split('/').pop() || '';
	if (filename.toLowerCase() === lowerQuery) {
		return 900;
	}

	// Path ends with query
	if (lowerPath.endsWith(lowerQuery)) {
		return 850;
	}

	// Filename starts with query
	if (filename.toLowerCase().startsWith(lowerQuery)) {
		return 800;
	}

	// Path starts with query
	if (lowerPath.startsWith(lowerQuery)) {
		return 750;
	}

	// Filename contains query as substring
	if (filename.toLowerCase().includes(lowerQuery)) {
		return 700;
	}

	// Path contains query as substring
	if (lowerPath.includes(lowerQuery)) {
		return 600;
	}

	// Sequential character match (fuzzy)
	let pathIndex = 0;
	let queryIndex = 0;
	let lastMatchIndex = -1;
	let consecutiveMatches = 0;

	while (pathIndex < lowerPath.length && queryIndex < lowerQuery.length) {
		if (lowerPath[pathIndex] === lowerQuery[queryIndex]) {
			// Bonus for consecutive matches
			if (pathIndex === lastMatchIndex + 1) {
				consecutiveMatches++;
			} else {
				consecutiveMatches = 1;
			}
			lastMatchIndex = pathIndex;
			queryIndex++;
		}
		pathIndex++;
	}

	// If all query characters matched
	if (queryIndex === lowerQuery.length) {
		// Score based on match density and consecutive matches
		const matchDensity = lowerQuery.length / lowerPath.length;
		const consecutiveBonus = consecutiveMatches * 50;
		return Math.min(500 + matchDensity * 100 + consecutiveBonus, 599);
	}

	// No match
	return 0;
}

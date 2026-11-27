interface ParsedVersion {
	core: number[];
	prerelease: string[];
}

function numericCoreSegment(segment: string): number {
	if (!/^\d+$/.test(segment)) return 0;
	const parsed = Number(segment);
	return Number.isSafeInteger(parsed) ? parsed : 0;
}

function parseVersion(version: string): ParsedVersion {
	const withoutPrefix = version.trim().replace(/^v/, '');
	const withoutBuild = withoutPrefix.split('+', 1)[0] ?? '';
	const prereleaseStart = withoutBuild.indexOf('-');
	const coreText =
		prereleaseStart === -1
			? withoutBuild
			: withoutBuild.slice(0, prereleaseStart);
	const prereleaseText =
		prereleaseStart === -1
			? undefined
			: withoutBuild.slice(prereleaseStart + 1);

	return {
		core: coreText.split('.').map(numericCoreSegment),
		prerelease: prereleaseText === undefined ? [] : prereleaseText.split('.'),
	};
}

function compareNumericIdentifiers(left: string, right: string): number {
	const normalizedLeft = left.replace(/^0+/, '') || '0';
	const normalizedRight = right.replace(/^0+/, '') || '0';
	if (normalizedLeft.length !== normalizedRight.length) {
		return normalizedLeft.length < normalizedRight.length ? -1 : 1;
	}
	if (normalizedLeft === normalizedRight) return 0;
	return normalizedLeft < normalizedRight ? -1 : 1;
}

function comparePrereleaseIdentifiers(left: string, right: string): number {
	const leftNumeric = /^\d+$/.test(left);
	const rightNumeric = /^\d+$/.test(right);
	if (leftNumeric && rightNumeric) {
		return compareNumericIdentifiers(left, right);
	}
	// Numeric prerelease identifiers have lower precedence than alphanumeric ones.
	if (leftNumeric) return -1;
	if (rightNumeric) return 1;
	if (left === right) return 0;
	return left < right ? -1 : 1;
}

function comparePrerelease(left: string[], right: string[]): number {
	// A version without a prerelease has higher precedence than one with it.
	if (left.length === 0 && right.length === 0) return 0;
	if (left.length === 0) return 1;
	if (right.length === 0) return -1;

	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index++) {
		const leftIdentifier = left[index];
		const rightIdentifier = right[index];
		if (leftIdentifier === undefined) return -1;
		if (rightIdentifier === undefined) return 1;
		const comparison = comparePrereleaseIdentifiers(
			leftIdentifier,
			rightIdentifier,
		);
		if (comparison !== 0) return comparison;
	}
	return 0;
}

/** Returns a negative number when left is older, zero when equal, positive when newer. */
function compareVersions(left: string, right: string): number {
	const leftParsed = parseVersion(left);
	const rightParsed = parseVersion(right);
	const length = Math.max(leftParsed.core.length, rightParsed.core.length);

	for (let index = 0; index < length; index++) {
		const leftPart = leftParsed.core[index] ?? 0;
		const rightPart = rightParsed.core[index] ?? 0;
		if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
	}

	return comparePrerelease(leftParsed.prerelease, rightParsed.prerelease);
}

/** Returns true when `latest` is a newer version than `current`. */
export function isNewerVersion(current: string, latest: string): boolean {
	return compareVersions(current, latest) < 0;
}
